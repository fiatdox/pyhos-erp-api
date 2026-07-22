-- ============================================================================
-- IT Project Roadmap (Gantt) module — schema core_kon
-- แผนโครงการของกลุ่มงานเทคโนโลยีสารสนเทศ (โครงการ/งานย่อย/หมุดหมาย + dependency + progress log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS it_roadmap_tasks (
    id                SERIAL PRIMARY KEY,
    code              VARCHAR(50),
    text              VARCHAR(500) NOT NULL,
    type              VARCHAR(20) NOT NULL DEFAULT 'task',      -- project | task | milestone
    parent_id         INT REFERENCES it_roadmap_tasks(id) ON DELETE CASCADE,
    mission           VARCHAR(30) NOT NULL,                     -- infra|security|application|support|smart
    fiscal_year       SMALLINT,                                 -- ปีงบประมาณ (พ.ศ.) เช่น 2569 — ถ้าเว้นว่างจะคำนวณจาก start_date (ต.ค.–ก.ย.)
    start_date        TIMESTAMPTZ NOT NULL,
    end_date          TIMESTAMPTZ NOT NULL,
    progress          INT,
    status            VARCHAR(20),                              -- draft|proposed|approved|in_progress|on_hold|completed|cancelled
    priority          VARCHAR(20),                              -- high|medium|low
    owner             VARCHAR(150),
    owner_user_id     INT,                                      -- อ้างอิงผู้ใช้จริง (role IT_STAFF)
    owner_position    VARCHAR(200),
    department        VARCHAR(200),
    contact           VARCHAR(100),
    team              JSONB,
    budget_requested  NUMERIC(14,2),
    budget_approved   NUMERIC(14,2),
    budget_spent      NUMERIC(14,2),
    budget_source     VARCHAR(200),
    kpi_code          VARCHAR(30),
    kpi_name          VARCHAR(255),
    kpi_target        VARCHAR(100),
    description       TEXT,
    expected_outcome  TEXT,
    vendor            VARCHAR(200),
    documents         JSONB,
    risk_note         TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by        INT
);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_parent  ON it_roadmap_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_mission ON it_roadmap_tasks(mission);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_fy      ON it_roadmap_tasks(fiscal_year);

-- migration (idempotent): เพิ่มคอลัมน์ปีงบให้ตารางเดิม + backfill จาก start_date
ALTER TABLE it_roadmap_tasks ADD COLUMN IF NOT EXISTS fiscal_year SMALLINT;
UPDATE it_roadmap_tasks
   SET fiscal_year = CASE WHEN EXTRACT(MONTH FROM start_date) >= 10
                          THEN EXTRACT(YEAR FROM start_date) + 1 + 543
                          ELSE EXTRACT(YEAR FROM start_date)     + 543 END
 WHERE fiscal_year IS NULL;

CREATE TABLE IF NOT EXISTS it_roadmap_links (
    id         SERIAL PRIMARY KEY,
    source_id  INT NOT NULL REFERENCES it_roadmap_tasks(id) ON DELETE CASCADE,
    target_id  INT NOT NULL REFERENCES it_roadmap_tasks(id) ON DELETE CASCADE,
    link_type  INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_roadmap_links_src ON it_roadmap_links(source_id);

CREATE TABLE IF NOT EXISTS it_roadmap_progress_logs (
    id                 SERIAL PRIMARY KEY,
    task_id            INT NOT NULL REFERENCES it_roadmap_tasks(id) ON DELETE CASCADE,
    log_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    progress           INT NOT NULL,
    note               TEXT,
    reported_by        VARCHAR(150),
    budget_spent_delta NUMERIC(14,2),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by         INT
);
CREATE INDEX IF NOT EXISTS idx_roadmap_logs_task ON it_roadmap_progress_logs(task_id);
