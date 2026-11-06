import { useEffect, useRef, useState } from 'react';
import { api, streamChat } from './api.js';
import {
  PipelineBar, PipelineTrace, Citations, FactCheckBadge, RouteBadge, MarkdownLite,
} from './components.jsx';

const STAGE_ORDER = ['deid', 'route', 'graph', 'retrieve', 'generate', 'factcheck', 'reid'];
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

function isTransient(msg) {
  const t = (msg || '').toLowerCase();
  return ['rate limit', '429', 'quota', '503', 'unavailable', 'overload', 'high demand', 'hạn ngạch', 'quá tải'].some((k) => t.includes(k));
}

export default function ChatView({ conversationId, selectedModel, onConversationStarted, onAfterChat }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeStage, setActiveStage] = useState(null);
  const [status, setStatus] = useState('');
  const endRef = useRef(null);
  const convRef = useRef(conversationId);
  const activeStreamConvIdRef = useRef(null);

  useEffect(() => { convRef.current = conversationId; }, [conversationId]);

  // Load lịch sử khi mở 1 hội thoại.
  useEffect(() => {
    let cancel = false;
    if (!conversationId) { setMessages([]); return; }
    // Nếu conversationId được cập nhật từ chính cuộc hội thoại đang stream, không ghi đè messages
    if (activeStreamConvIdRef.current === conversationId) return;
    api.getConversation(conversationId)
      .then((d) => { if (!cancel) setMessages((d.messages || []).map((m) => ({
        role: m.role, content: m.content, sources: m.sources || [],
        pipeline: m.pipeline && m.pipeline.factcheck ? { factcheck: m.pipeline.factcheck } : (m.pipeline || null),
        factcheck: (m.pipeline && m.pipeline.factcheck) || null,
      }))); })
      .catch(() => { if (!cancel) setMessages([]); });
    return () => { cancel = true; };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const patchBot = (patch) => setMessages((prev) => {
    const next = [...prev];
    const i = next.length - 1;
    if (i >= 0 && next[i].role === 'bot') next[i] = { ...next[i], ...(typeof patch === 'function' ? patch(next[i]) : patch) };
    return next;
  });

  const attempt = async (question, model) => {
    let gotToken = false; let errorMsg = null;
    patchBot({ content: '', streaming: true, pipeline: null, sources: [], factcheck: null, error: false });
    await streamChat({ message: question, model, conversation_id: convRef.current }, (ev) => {
      if (ev.type === 'conversation') {
        if (!convRef.current && ev.data?.conversation_id) {
          const newId = ev.data.conversation_id;
          convRef.current = newId;
          activeStreamConvIdRef.current = newId;
          onConversationStarted?.(newId);
        }
      } else if (ev.type === 'pipeline') {
        patchBot({ pipeline: ev.data });
        if (ev.data?.route?.intent === 'chitchat') {
          setActiveStage('generate');
          setStatus('Đang phản hồi…');
        } else {
          setActiveStage('retrieve');
          setStatus('Đã truy xuất ngữ cảnh, đang sinh câu trả lời…');
        }
      } else if (ev.type === 'token') {
        gotToken = true; setActiveStage('generate');
        patchBot((m) => ({ content: (m.content || '') + ev.data }));
      } else if (ev.type === 'done') {
        setActiveStage(null);
        patchBot({ streaming: false, content: ev.data.answer || '', sources: ev.data.sources || [], factcheck: ev.data.factcheck || null });
        setStatus('Hoàn tất');
      } else if (ev.type === 'error') {
        errorMsg = ev.data;
      }
    });
    return { gotToken, errorMsg };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    setActiveStage('deid');
    setMessages((prev) => [...prev, { role: 'bot', content: '', streaming: true, pipeline: null, sources: [], factcheck: null }]);

    try {
      let model = selectedModel;
      const order = FALLBACK_MODELS.includes(model) ? FALLBACK_MODELS : [model, ...FALLBACK_MODELS];
      let idx = order.indexOf(model);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        setStatus(`Đang xử lý với ${model}…`);
        let res;
        try {
          res = await attempt(question, model);
        } catch (err) {
          res = { gotToken: false, errorMsg: err.message };
        }
        if (!res.errorMsg) break;
        const next = (!res.gotToken && isTransient(res.errorMsg) && idx < order.length - 1) ? order[++idx] : null;
        if (next) { model = next; setStatus(`Model quá tải/hết quota, chuyển sang ${next}…`); continue; }
        patchBot((m) => ({ streaming: false, content: (m.content || '') + `\n\n⚠️ ${res.errorMsg}`, error: true }));
        setStatus('Có lỗi xảy ra');
        break;
      }
      onAfterChat?.();
    } finally {
      activeStreamConvIdRef.current = null;
      setLoading(false);
      setActiveStage(null);
    }
  };

  return (
    <div className="chat-view">
      <PipelineBar order={STAGE_ORDER} active={activeStage} />
      <div className="chat-scroll">
        <div className="chat-inner">
          {messages.length === 0 ? (
            <EmptyState onPick={(q) => setInput(q)} />
          ) : (
            <div className="message-list">
              {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      <div className="composer">
        <form onSubmit={handleSubmit} className="input-form">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder="Nhập câu hỏi tra cứu y khoa…" disabled={loading} />
          <button type="submit" disabled={loading || !input.trim()}>{loading ? '…' : 'Gửi'}</button>
        </form>
        {status && <div className="status-line">{status}</div>}
      </div>
    </div>
  );
}

function EmptyState({ onPick }) {
  const samples = [
    'Phác đồ điều trị đái tháo đường týp 2 dùng thuốc gì đầu tiên?',
    'Metformin có chống chỉ định khi suy thận không?',
    'Metformin có tương tác với rượu bia không?',
    'Mục tiêu HbA1c trong điều trị đái tháo đường là bao nhiêu?',
  ];
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">🩺</div>
      <h2>Bắt đầu tra cứu lâm sàng</h2>
      <p>Hỏi về phác đồ, tương tác thuốc, chống chỉ định… Hệ thống truy xuất y văn + tài liệu của bạn + Knowledge Graph và luôn kèm trích dẫn nguồn.</p>
      <div className="samples">
        {samples.map((s) => <button key={s} className="sample-chip" onClick={() => onPick(s)}>{s}</button>)}
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`message ${msg.role}`}>
      <div className="avatar" aria-hidden="true">{isUser ? '👤' : '✚'}</div>
      <div className={`bubble ${msg.error ? 'bubble-error' : ''}`}>
        {!isUser && (msg.pipeline?.route || msg.factcheck) && (
          <div className="bubble-topmeta">
            {msg.pipeline?.route && <RouteBadge route={msg.pipeline.route} />}
            {msg.pipeline?.deid?.total > 0 && <span className="chip chip-phi">🔐 Đã ẩn danh {msg.pipeline.deid.total} PHI</span>}
            {msg.factcheck && <FactCheckBadge fc={msg.factcheck} />}
          </div>
        )}
        <div className="bubble-content">
          {msg.content
            ? (isUser ? <p>{msg.content}</p> : <MarkdownLite text={msg.content} />)
            : (msg.streaming ? <TypingDots /> : <p className="muted">Không có phản hồi.</p>)}
          {msg.streaming && msg.content && <span className="caret" />}
        </div>
        {!isUser && !msg.streaming && msg.sources?.length > 0 && <Citations sources={msg.sources} />}
        {!isUser && msg.pipeline?.retrieval && <PipelineTrace pipeline={msg.pipeline} />}
      </div>
    </div>
  );
}

function TypingDots() {
  return <span className="typing"><i></i><i></i><i></i></span>;
}
