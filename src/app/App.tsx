import { useEffect, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TimelinePage } from "../pages/TimelinePage/TimelinePage";
import { SettingsPage } from "../pages/SettingsPage/SettingsPage";
import { InventoryPage } from "../pages/InventoryPage/InventoryPage";
import { StatisticsPage } from "../pages/StatisticsPage/StatisticsPage";
import { Icon } from "../shared/components/Icon";
import { useTimelineThemeStore } from "../stores/timelineThemeStore";
import { usePersistenceStatusStore } from "../stores/persistenceStatusStore";
import { bootstrapDatabasePersistence } from "../features/inventory/databasePersistence";
import { invokePersistence as invoke } from "../features/inventory/persistenceGateway";
import { requestAppShutdown } from "../features/inventory/appShutdown";
import styles from "./App.module.css";

type PageId = "timeline" | "inventory" | "statistics" | "settings";

const navigation: Array<{
  id: PageId;
  label: string;
  icon: "timeline" | "inventory" | "chart" | "settings";
}> = [
  { id: "timeline", label: "时间轴", icon: "timeline" },
  { id: "inventory", label: "库存", icon: "inventory" },
  { id: "statistics", label: "统计", icon: "chart" },
  { id: "settings", label: "设置", icon: "settings" }
];

export function App() {
  const [page, setPage] = useState<PageId>("timeline");
  const [startupPhase, setStartupPhase] = useState<"loading" | "ready" | "error">("loading");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  const [shutdownError, setShutdownError] = useState<string | null>(null);
  const palette = useTimelineThemeStore((state) => state.palette);
  const persistencePhase = usePersistenceStatusStore((state) => state.phase);
  const persistenceError = usePersistenceStatusStore((state) => state.error);
  useEffect(() => {
    void (async () => {
      await bootstrapDatabasePersistence();
      setStartupNotice(await invoke<string | null>("get_startup_notice"));
      setStartupPhase("ready");
    })().catch((error) => {
      setStartupError(error instanceof Error ? error.message : String(error));
      setStartupPhase("error");
    });
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        setShutdownError(null);
        try {
          await requestAppShutdown("exit");
        } catch (error) {
          setShutdownError(error instanceof Error ? error.message : String(error));
          closing = false;
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      });
    return () => unlisten?.();
  }, []);
  const paletteVariables = {
    "--color-active": palette.active,
    "--color-paused": palette.paused,
    "--color-completed": palette.completed,
    "--color-review": palette.review,
    "--color-protein": palette.protein,
    "--color-forecast": palette.forecast,
    "--color-planned": palette.forecast,
    "--color-historical-paused": palette.historicalPaused,
    "--color-danger": palette.danger
  } as CSSProperties;

  if (startupPhase === "loading") {
    return (
      <div className={styles.startupLoading}>
        {shutdownError ? `无法安全退出：${shutdownError}` : "正在检查数据位置…"}
      </div>
    );
  }

  if (startupPhase === "error") {
    return (
      <div className={styles.startupFailure} role="alert">
        <section>
          <h1>无法打开业务数据</h1>
          <p>为避免产生无法保存的数据，应用已停止进入业务界面。</p>
          <code>{startupError}</code>
          {shutdownError && <code>{shutdownError}</code>}
          <button onClick={() => window.location.reload()} type="button">重新尝试</button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.app} style={paletteVariables}>
      {startupNotice && (
        <div className={styles.recoveryNotice} role="alert">
          <span>{startupNotice}</span>
          <button onClick={() => setPage("settings")} type="button">前往数据恢复</button>
          <button aria-label="关闭提示" onClick={() => setStartupNotice(null)} type="button">×</button>
        </div>
      )}
      {persistencePhase === "error" && (
        <div className={styles.persistenceError} role="alert">
          <div>
            <strong>数据保存失败</strong>
            <span>本次修改未写入 SQLite，界面没有提交该修改。</span>
            <code>{persistenceError}</code>
          </div>
          <button
            onClick={() => window.location.reload()}
            type="button"
          >
            重新加载数据
          </button>
        </div>
      )}
      {shutdownError && (
        <div className={styles.persistenceError} role="alert">
          <div>
            <strong>无法安全退出</strong>
            <span>应用保持打开，数据连接尚未被强制中断，可以修正问题后重试。</span>
            <code>{shutdownError}</code>
          </div>
          <button onClick={() => setShutdownError(null)} type="button">关闭提示</button>
        </div>
      )}
      <main className={styles.main}>
        {page === "timeline" ? (
          <TimelinePage onNavigateToInventory={() => setPage("inventory")} />
        ) : page === "inventory" ? (
          <InventoryPage onNavigateToTimeline={() => setPage("timeline")} />
        ) : page === "statistics" ? (
          <StatisticsPage onNavigateToInventory={() => setPage("inventory")} />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : null}
      </main>
      <nav className={styles.navigation} aria-label="主导航">
        <div className={styles.navItems}>
          {navigation.map((item) => (
            <button
              className={page === item.id ? styles.navActive : styles.navButton}
              key={item.id}
              onClick={() => setPage(item.id)}
              type="button"
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
