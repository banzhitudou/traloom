-- Traloom 数据库建表脚本
-- 对应《技术方案文档》第 4.2 节

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────
-- 项目元信息（单行表，key-value）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS recognized_page (
  page_idx INTEGER PRIMARY KEY,
  method TEXT NOT NULL,
  blocks_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_resource (
  path TEXT PRIMARY KEY,
  content BLOB NOT NULL,
  sha256 TEXT NOT NULL
);
-- 存：book_title, src_lang, tgt_lang, pdf_path, json_path,
--     style_guide_text, created_at, schema_version

-- ──────────────────────────────────────────────
-- 段落（核心表，来自 content_list_v2.json 扁平化）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paragraph (
  id          INTEGER PRIMARY KEY,   -- 段顺序号（从1开始）
  page_idx    INTEGER NOT NULL,      -- 所在页（0-based，pdf.js 用）
  type        TEXT NOT NULL,         -- title / paragraph / list / ...
  en_text     TEXT NOT NULL DEFAULT '',
  zh_text     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo',  -- todo / doing / done / review
  sort_order  INTEGER NOT NULL DEFAULT 0,    -- 页内阅读/翻译顺序；段号 id 保持稳定
  bbox_json   TEXT NOT NULL DEFAULT '[]',
  raw_block   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_paragraph_page ON paragraph(page_idx);
CREATE INDEX IF NOT EXISTS idx_paragraph_status ON paragraph(status);
CREATE TABLE IF NOT EXISTS paragraph_note (
  paragraph_id INTEGER PRIMARY KEY REFERENCES paragraph(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT ''
);

-- MinerU 文件包中的 Markdown 文档，供项目浏览和 AI 上下文使用。
CREATE TABLE IF NOT EXISTS project_document (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'mineru_markdown',
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_document_kind ON project_document(kind);

-- ──────────────────────────────────────────────
-- 术语表（来自 术语对照表.md）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS glossary (
  id        INTEGER PRIMARY KEY,
  category  TEXT NOT NULL DEFAULT '其他',
  en        TEXT NOT NULL,
  zh        TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_glossary_en ON glossary(en);

-- 术语变更历史。项目术语修改后保留旧值、新值和操作类型。
CREATE TABLE IF NOT EXISTS glossary_change (
  id          INTEGER PRIMARY KEY,
  glossary_id INTEGER,
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  old_en      TEXT NOT NULL DEFAULT '',
  new_en      TEXT NOT NULL DEFAULT '',
  old_zh      TEXT NOT NULL DEFAULT '',
  new_zh      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 一次术语变更在全文中的逐段确认状态与替换前快照。
CREATE TABLE IF NOT EXISTS glossary_review (
  id            INTEGER PRIMARY KEY,
  change_id     INTEGER NOT NULL REFERENCES glossary_change(id) ON DELETE CASCADE,
  paragraph_id  INTEGER NOT NULL REFERENCES paragraph(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'replaced', 'kept', 'review')),
  previous_zh   TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(change_id, paragraph_id)
);
CREATE INDEX IF NOT EXISTS idx_glossary_review_change ON glossary_review(change_id, status);

CREATE TABLE IF NOT EXISTS glossary_acceptance (
  glossary_id INTEGER NOT NULL REFERENCES glossary(id) ON DELETE CASCADE,
  paragraph_id INTEGER NOT NULL REFERENCES paragraph(id) ON DELETE CASCADE,
  en TEXT NOT NULL,
  zh TEXT NOT NULL,
  en_text TEXT NOT NULL,
  zh_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(glossary_id, paragraph_id)
);

-- ──────────────────────────────────────────────
-- 人名大辞典（FTS5 全文索引，来自 csv）
-- ──────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS name_dict USING fts5(
  en, zh, source,
  tokenize = 'unicode61'
);

-- ──────────────────────────────────────────────
-- 地名手册（FTS5，来自 xlsx）
-- ──────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS place_dict USING fts5(
  en, zh,
  tokenize = 'unicode61'
);

-- ──────────────────────────────────────────────
-- LLM 配置（API Key 加密后存）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_config (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'openai_chat',
  base_url      TEXT NOT NULL DEFAULT '',
  api_key_enc   BLOB,
  model         TEXT NOT NULL DEFAULT '',
  temperature   REAL NOT NULL DEFAULT 0.3,
  max_tokens    INTEGER NOT NULL DEFAULT 2048,
  system_prompt TEXT NOT NULL DEFAULT '',
  is_default    INTEGER NOT NULL DEFAULT 0
);

-- ──────────────────────────────────────────────
-- 任务-模型分配（哪个 AI 任务用哪个配置）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_assignment (
  task      TEXT PRIMARY KEY,        -- whole_para / hard_sentence / ...
  config_id INTEGER REFERENCES llm_config(id) ON DELETE SET NULL
);

-- ──────────────────────────────────────────────
-- AI 决策留痕（P2，MVP 先建表）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_log (
  id           INTEGER PRIMARY KEY,
  paragraph_id INTEGER,
  task         TEXT NOT NULL,
  input_text   TEXT NOT NULL DEFAULT '',
  output_text  TEXT NOT NULL DEFAULT '',
  adopted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 悬浮助手对话历史，跟随 .twproj 持久化。
CREATE TABLE IF NOT EXISTS assistant_message (
  id           INTEGER PRIMARY KEY,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  paragraph_id INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_message_created ON assistant_message(created_at);
