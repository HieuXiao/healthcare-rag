"""Router: quản lý hội thoại + chat (non-stream & SSE), lưu lịch sử theo account."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from api import usage
from api.schemas import ChatRequest
from core import auth, config, services
from core.db import SessionLocal, get_db
from core.generator import build_pipeline, get_default_api_key
from core.models import ActivityLog, Conversation, Message, User

router = APIRouter(tags=["chat"])


# ---- Conversations --------------------------------------------------------
def _conv_out(c: Conversation):
    return {
        "id": c.id,
        "title": c.title,
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def _msg_out(m: Message):
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "sources": json.loads(m.sources_json) if m.sources_json else [],
        "pipeline": json.loads(m.pipeline_json) if m.pipeline_json else {},
        "created_at": m.created_at.isoformat() if m.created_at else "",
    }


@router.get("/conversations")
def list_conversations(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    convs = db.query(Conversation).filter(Conversation.user_id == user.id) \
        .order_by(Conversation.updated_at.desc()).all()
    return {"conversations": [_conv_out(c) for c in convs]}


@router.post("/conversations")
def create_conversation(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    conv = Conversation(user_id=user.id, title="Cuộc trò chuyện mới")
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conv_out(conv)


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: int, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    return {"conversation": _conv_out(conv), "messages": [_msg_out(m) for m in conv.messages]}


@router.put("/conversations/{conv_id}")
def rename_conversation(conv_id: int, payload: dict, user: User = Depends(auth.get_current_user),
                        db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    title = (payload.get("title") or "").strip()
    if title:
        conv.title = title[:255]
        db.commit()
    return _conv_out(conv)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conv_id, Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    db.delete(conv)
    db.commit()
    return {"ok": True}


# ---- helpers --------------------------------------------------------------
def _resolve_pipeline(req: ChatRequest):
    model = (req.model or config.DEFAULT_MODEL).strip()
    api_key = (req.api_key or "").strip() or get_default_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="Chưa cấu hình API key (hệ thống hoặc người dùng).")
    try:
        return build_pipeline(api_key=api_key, model_name=model), model
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Không khởi tạo được pipeline: {e}")


def _ensure_conversation(db, user, conversation_id, first_message):
    if conversation_id:
        conv = db.query(Conversation).filter(
            Conversation.id == conversation_id, Conversation.user_id == user.id).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại")
    else:
        title = (first_message or "Cuộc trò chuyện mới").strip()[:48]
        conv = Conversation(user_id=user.id, title=title or "Cuộc trò chuyện mới")
        db.add(conv)
        db.commit()
        db.refresh(conv)
    return conv


# ---- Chat (non-stream) ----------------------------------------------------
@router.post("/chat")
def chat(req: ChatRequest, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if not (req.message or "").strip():
        raise HTTPException(status_code=400, detail="Câu hỏi trống.")
    usage.reset_if_new_day()

    pipeline, model = _resolve_pipeline(req)
    conv = _ensure_conversation(db, user, req.conversation_id, req.message)
    allowed_keys, base_allowed = services.allowed_doc_scope(db, user)
    profile_text = services.build_profile_text(user)

    db.add(Message(conversation_id=conv.id, role="user", content=req.message))
    db.commit()

    try:
        result = pipeline.run(req.message, allowed_keys=allowed_keys,
                              base_allowed=base_allowed, profile_text=profile_text)
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "429" in msg or "resource_exhausted" in low or "quota" in low:
            raise HTTPException(status_code=429, detail="Đã hết hạn ngạch model (free-tier). Thử model khác hoặc chờ reset.")
        if "503" in msg or "unavailable" in low or "high demand" in low:
            raise HTTPException(status_code=503, detail="Model đang quá tải (503). Vui lòng thử lại hoặc đổi model.")
        raise HTTPException(status_code=502, detail=f"Lỗi sinh câu trả lời: {msg[:200]}")
    usage.increment(model)

    answer = (result.get("answer") or "").strip() or "Không tạo được câu trả lời."
    pipe_meta = result.get("pipeline", {})
    sources = result.get("sources", [])

    db.add(Message(conversation_id=conv.id, role="bot", content=answer,
                   sources_json=json.dumps(sources, ensure_ascii=False),
                   pipeline_json=json.dumps(pipe_meta, ensure_ascii=False)))
    db.add(ActivityLog(user_id=user.id, action="chat", detail=req.message[:200], model=model,
                       grounded_ratio=(pipe_meta.get("factcheck") or {}).get("grounded_ratio")))
    conv.title = conv.title if conv.title != "Cuộc trò chuyện mới" else req.message.strip()[:48]
    db.commit()

    return {"answer": answer, "sources": sources, "citations": sources,
            "pipeline": pipe_meta, "conversation_id": conv.id}


# ---- Chat (SSE stream) ----------------------------------------------------
@router.post("/chat/stream")
def chat_stream(req: ChatRequest, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if not (req.message or "").strip():
        raise HTTPException(status_code=400, detail="Câu hỏi trống.")
    usage.reset_if_new_day()

    pipeline, model = _resolve_pipeline(req)
    conv = _ensure_conversation(db, user, req.conversation_id, req.message)
    allowed_keys, base_allowed = services.allowed_doc_scope(db, user)
    profile_text = services.build_profile_text(user)
    user_id = user.id
    conv_id = conv.id
    question = req.message

    # Lưu câu hỏi của user ngay.
    db.add(Message(conversation_id=conv_id, role="user", content=question))
    if conv.title == "Cuộc trò chuyện mới":
        conv.title = question.strip()[:48]
    db.commit()

    def event_generator():
        final = None
        try:
            # Gửi conversation_id trước để frontend gắn vào hội thoại mới.
            yield f"data: {json.dumps({'type': 'conversation', 'data': {'conversation_id': conv_id}}, ensure_ascii=False)}\n\n"
            for event in pipeline.stream(question, allowed_keys=allowed_keys,
                                         base_allowed=base_allowed, profile_text=profile_text):
                if event.get("type") == "done":
                    final = event["data"]
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            # Lưu kết quả vào DB bằng session mới (session request đã đóng khi stream).
            if final:
                usage.increment(model)
                _db = SessionLocal()
                try:
                    _db.add(Message(
                        conversation_id=conv_id, role="bot",
                        content=final.get("answer", ""),
                        sources_json=json.dumps(final.get("sources", []), ensure_ascii=False),
                        pipeline_json=json.dumps({"factcheck": final.get("factcheck", {}),
                                                  "timings": final.get("timings", {})}, ensure_ascii=False),
                    ))
                    _db.add(ActivityLog(
                        user_id=user_id, action="chat", detail=question[:200], model=model,
                        grounded_ratio=(final.get("factcheck") or {}).get("grounded_ratio"),
                    ))
                    _db.commit()
                except Exception as exc:
                    print(f"[chat/stream] Lỗi lưu lịch sử: {exc}")
                finally:
                    _db.close()

    return StreamingResponse(
        event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
