import type { LocalDate } from "../../shared/dates/localDate";
import { displayLocalDate } from "../../shared/dates/localDate";
import styles from "./TimelinePage.module.css";

export interface LifecycleHistoryEntry {
  date: LocalDate;
  label: string;
  detail: string;
  pauseIndex?: number;
}

interface LifecycleHistorySectionProps {
  entries: LifecycleHistoryEntry[];
  onEditPause: (pauseIndex: number) => void;
}

export function LifecycleHistorySection({
  entries,
  onEditPause
}: LifecycleHistorySectionProps) {
  return (
    <section className={styles.usageHistory}>
      <div className={styles.usageHistoryHeading}>
        <div>
          <strong>使用历史</strong>
          <span>{entries.length} 个状态节点</span>
        </div>
      </div>
      <div className={styles.usageHistoryList}>
        {entries.map((entry, index) => (
          <article
            className={styles.usageHistoryRecord}
            key={`${entry.date}-${entry.label}-${index}`}
          >
            <span className={styles.usageHistoryDot} />
            <div>
              <strong>{entry.label}</strong>
              <span>
                {displayLocalDate(entry.date)} · {entry.detail}
              </span>
            </div>
            {entry.pauseIndex !== undefined && (
              <button
                onClick={() => onEditPause(entry.pauseIndex!)}
                type="button"
              >
                编辑阶段
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
