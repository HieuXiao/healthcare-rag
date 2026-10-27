"""
Nạp Knowledge Graph y khoa vào Neo4j từ dữ liệu seed (core/graph_seed.py).

Cách chạy (sau khi Neo4j đã chạy qua docker-compose):
    cd backend
    python scripts/build_graph.py

Dữ liệu seed là đồ thị tự curate quanh Đái tháo đường + ICD-10 (miễn phí),
KHÔNG dùng SNOMED/UMLS để tránh vướng bản quyền.
"""

import os
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Cho phép import package `core` khi chạy trực tiếp.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

from core import config
from core import graph_seed


def main():
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("❌ Thiếu thư viện 'neo4j'. Chạy: pip install neo4j")
        sys.exit(1)

    print(f"Kết nối Neo4j tại {config.NEO4J_URI} ...")
    driver = GraphDatabase.driver(
        config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD)
    )
    try:
        driver.verify_connectivity()
    except Exception as exc:
        print(f"❌ Không kết nối được Neo4j: {exc}")
        print("   → Hãy chạy 'docker compose up -d neo4j' và đợi vài giây.")
        sys.exit(1)

    with driver.session(database=config.NEO4J_DATABASE) as session:
        print("Xoá dữ liệu cũ...")
        session.run("MATCH (n:Entity) DETACH DELETE n")

        print("Tạo constraint...")
        session.run(
            "CREATE CONSTRAINT entity_name IF NOT EXISTS "
            "FOR (e:Entity) REQUIRE e.name IS UNIQUE"
        )

        print(f"Nạp {len(graph_seed.ENTITIES)} thực thể...")
        for name, meta in graph_seed.ENTITIES.items():
            session.run(
                "MERGE (e:Entity {name: $name}) "
                "SET e.type = $type, e.icd10 = $icd10, e.synonyms = $syn",
                name=name,
                type=meta.get("type", ""),
                icd10=meta.get("icd10"),
                syn=meta.get("synonyms", []),
            )

        print(f"Nạp {len(graph_seed.TRIPLES)} quan hệ...")
        for s, r, o in graph_seed.TRIPLES:
            session.run(
                "MATCH (a:Entity {name: $s}) "
                "MATCH (b:Entity {name: $o}) "
                "MERGE (a)-[rel:REL {label: $r}]->(b)",
                s=s, o=o, r=r,
            )

        count = session.run("MATCH (n:Entity) RETURN count(n) AS c").single()["c"]
        rels = session.run("MATCH ()-[r:REL]->() RETURN count(r) AS c").single()["c"]

    driver.close()
    print(f"✅ Hoàn tất: {count} thực thể, {rels} quan hệ đã nạp vào Neo4j.")


if __name__ == "__main__":
    main()
