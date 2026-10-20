"""
GraphRAG store: Entity Matching -> Graph Traversal -> Triple Textualization.

Ưu tiên kết nối Neo4j thật (Community local qua Docker). Nếu không kết nối được
và bật GRAPH_INMEMORY_FALLBACK, hệ thống tự dùng graph in-memory từ graph_seed để
không bao giờ gãy lúc demo. Dữ liệu là đồ thị tự curate quanh Đái tháo đường +
ICD-10 (miễn phí), không dùng SNOMED/UMLS.

Pipeline:
  1. match_entities(query): nhận diện thực thể y khoa trong câu hỏi.
  2. traverse(entities):     lấy các triple liên quan (đa bước 1 hop).
  3. textualize(triples):    chuyển triple thành câu tự nhiên nạp vào prompt.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from core import config
from core import graph_seed


@dataclass
class GraphContext:
    entities: List[str] = field(default_factory=list)
    triples: List[Tuple[str, str, str]] = field(default_factory=list)
    text: str = ""
    backend: str = "none"       # "neo4j" | "mock" | "none"
    available: bool = False


class GraphStore:
    def __init__(self):
        self._driver = None
        self._backend = "none"
        self._lock = threading.Lock()
        self._initialized = False

    # ---- init / connect ------------------------------------------------
    def _ensure_init(self):
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return

            if not config.ENABLE_GRAPH or config.GRAPH_BACKEND in ("none", "off", "false", "0"):
                self._backend = "none"
                self._initialized = True
                print("[Graph] [OFF] Knowledge Graph da tat (GRAPH_BACKEND=none hoac ENABLE_GRAPH=false).")
                return

            # Chế độ Mock / In-memory có chủ đích
            if config.GRAPH_BACKEND in ("mock", "in-memory", "memory"):
                self._backend = "mock"
                self._initialized = True
                print("[Graph] [MOCK] Dang chay che do MOCK GRAPH (In-memory tu graph_seed).")
                print("       -> Dung du lieu mau co dinh cho Unit Test, CI/CD hoac Offline Dev.")
                return

            # Chế độ Neo4j chuẩn Production / Dev nghiêm ngặt
            if config.GRAPH_BACKEND == "neo4j":
                connected = self._try_connect_neo4j()
                if not connected:
                    if config.GRAPH_INMEMORY_FALLBACK:
                        self._backend = "mock"
                        print("[Graph] [WARN] CANH BAO: Khong ket noi duoc Neo4j. Chuyen sang MOCK In-memory vi GRAPH_INMEMORY_FALLBACK=true.")
                    else:
                        self._backend = "none"
                        self._initialized = True
                        raise RuntimeError(
                            f"\n[Graph Error] Khong the ket noi Neo4j tai {config.NEO4J_URI}!\n"
                            f"-> Hay bat container Neo4j: 'docker compose up -d neo4j'\n"
                            f"-> Hoac neu muon dev nhanh/offline ma khong can database, hay dat GRAPH_BACKEND=mock trong backend/.env\n"
                        )

            self._initialized = True

    def initialize(self):
        """Khởi tạo ngay lập tức khi ứng dụng khởi động (Fail-fast check)."""
        self._ensure_init()

    def _try_connect_neo4j(self) -> bool:
        try:
            from neo4j import GraphDatabase

            driver = GraphDatabase.driver(
                config.NEO4J_URI,
                auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
            )
            driver.verify_connectivity()
            # Kiểm tra đã có dữ liệu chưa.
            with driver.session(database=config.NEO4J_DATABASE) as session:
                count = session.run("MATCH (n:Entity) RETURN count(n) AS c").single()["c"]
            self._driver = driver
            self._backend = "neo4j"
            if count == 0:
                print("[Graph] [WARN] Neo4j da ket noi nhung chua co du lieu (0 thuc the).")
                print("       -> Hay chay: 'python scripts/build_graph.py' de nap du lieu y khoa.")
            else:
                print(f"[Graph] [OK] Ket noi Neo4j thanh cong ({count} thuc the).")
            return True
        except Exception as exc:  # pragma: no cover - phụ thuộc môi trường
            print(f"[Graph] [ERROR] Loi ket noi Neo4j ({exc}).")
            self._driver = None
            return False

    # ---- entity matching ----------------------------------------------
    @staticmethod
    def _match_in_text(query: str) -> List[str]:
        q = (query or "").lower()
        matched = []
        for name, meta in graph_seed.ENTITIES.items():
            names = [name.lower()] + [s.lower() for s in meta.get("synonyms", [])]
            icd = meta.get("icd10")
            if icd:
                names.append(icd.lower())
            if any(n in q for n in names):
                matched.append(name)
        return matched

    def match_entities(self, query: str) -> List[str]:
        return self._match_in_text(query)

    # ---- traversal -----------------------------------------------------
    def _traverse_inmemory(self, entities: List[str]) -> List[Tuple[str, str, str]]:
        ent_set = set(entities)
        found = []
        for s, r, o in graph_seed.TRIPLES:
            if s in ent_set or o in ent_set:
                found.append((s, r, o))
        return found[: config.GRAPH_MAX_TRIPLES]

    def _traverse_neo4j(self, entities: List[str]) -> List[Tuple[str, str, str]]:
        triples = []
        cypher = (
            "MATCH (a:Entity)-[rel]->(b:Entity) "
            "WHERE a.name IN $names OR b.name IN $names "
            "RETURN a.name AS s, rel.label AS r, b.name AS o "
            "LIMIT $limit"
        )
        try:
            with self._driver.session(database=config.NEO4J_DATABASE) as session:
                for rec in session.run(cypher, names=entities, limit=config.GRAPH_MAX_TRIPLES):
                    triples.append((rec["s"], rec["r"], rec["o"]))
        except Exception as exc:  # pragma: no cover
            print(f"[Graph] [WARN] Loi truy van Neo4j ({exc}).")
        return triples

    # ---- textualize ----------------------------------------------------
    @staticmethod
    def textualize(triples: List[Tuple[str, str, str]]) -> str:
        if not triples:
            return ""
        lines = [f"- {s} {r} {o}." for s, r, o in triples]
        return "Tri thức từ Knowledge Graph y khoa:\n" + "\n".join(lines)

    # ---- public --------------------------------------------------------
    def query(self, query: str) -> GraphContext:
        self._ensure_init()
        if self._backend == "none":
            return GraphContext(backend="none", available=False)

        entities = self.match_entities(query)
        if not entities:
            return GraphContext(entities=[], backend=self._backend, available=True)

        if self._backend == "neo4j":
            triples = self._traverse_neo4j(entities)
        else:
            triples = self._traverse_inmemory(entities)

        return GraphContext(
            entities=entities,
            triples=triples,
            text=self.textualize(triples),
            backend=self._backend,
            available=True,
        )

    def close(self):
        if self._driver is not None:
            self._driver.close()
            self._driver = None


# Singleton
_store: Optional[GraphStore] = None
_store_lock = threading.Lock()


def get_graph_store() -> GraphStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = GraphStore()
    return _store
