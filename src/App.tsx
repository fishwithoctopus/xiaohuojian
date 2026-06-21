import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkCrisis, aiRestate, aiSplit, aiAdvice, aiAnalyze, aiSummarize, type AdviceItem, type AnalysisItem } from "./ai";

/* ───── Audio system ───── */

const BGM_LOOP_END = 47;
const BGM_VOLUME = 0.2;

const SFX_FILES = {
  click: "/assets/audio/click.wav",
  launch: "/assets/audio/起飞.wav",
  capsuleDrop: "/assets/audio/舱体掉落.wav",
  unroll: "/assets/audio/展开.wav",
  typing: "/assets/audio/循环打字.mp3",
  scan: "/assets/audio/扫描.mp3",
  conveyor: "/assets/audio/传送带底噪.mp3",
  assemble: "/assets/audio/安装火箭.mp3",
  rocketBurst: "/assets/audio/火箭窜一下.wav",
} as const;

type SfxName = keyof typeof SFX_FILES;

class AudioManager {
  private bgm: HTMLAudioElement | null = null;
  private sfxCache = new Map<string, HTMLAudioElement>();
  private loopingSfx = new Map<string, HTMLAudioElement>();
  private started = false;
  private _musicEnabled = true;
  private _soundEnabled = true;
  private endingMode = false;

  init() {
    if (this.bgm) return;
    this.bgm = new Audio("/assets/audio/bgm.mp3");
    this.bgm.volume = BGM_VOLUME;
    this.bgm.addEventListener("timeupdate", () => {
      if (!this.endingMode && this.bgm && this.bgm.currentTime >= BGM_LOOP_END) {
        this.bgm.currentTime = 0;
      }
    });
  }

  startBgm() {
    if (this.started || !this._musicEnabled) return;
    this.init();
    this.bgm?.play().then(() => { this.started = true; }).catch(() => {});
  }

  switchToEnding() {
    this.endingMode = true;
  }

  set musicEnabled(val: boolean) {
    this._musicEnabled = val;
    if (this.bgm) {
      if (val && this.started) this.bgm.play().catch(() => {});
      else this.bgm.pause();
    }
  }

  set soundEnabled(val: boolean) {
    this._soundEnabled = val;
    if (!val) {
      this.loopingSfx.forEach(a => { a.pause(); a.currentTime = 0; });
      this.loopingSfx.clear();
    }
  }

  play(name: SfxName, opts?: { loop?: boolean; volume?: number }) {
    if (!this._soundEnabled) return;
    const src = SFX_FILES[name];
    const audio = new Audio(src);
    audio.volume = opts?.volume ?? 1;
    if (opts?.loop) {
      audio.loop = true;
      this.loopingSfx.set(name, audio);
    }
    audio.play().catch(() => {});
    return audio;
  }

  stop(name: SfxName) {
    const a = this.loopingSfx.get(name);
    if (a) { a.pause(); a.currentTime = 0; this.loopingSfx.delete(name); }
  }
}

const audioManager = new AudioManager();

function useAudio(soundOn: boolean, musicOn: boolean) {
  useEffect(() => { audioManager.soundEnabled = soundOn; }, [soundOn]);
  useEffect(() => { audioManager.musicEnabled = musicOn; }, [musicOn]);

  useEffect(() => {
    const handler = () => { audioManager.startBgm(); };
    document.addEventListener("pointerdown", handler, { once: true });
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  return audioManager;
}

const loadingFrames = [
  "/assets/loading/rocket-short.svg",
  "/assets/loading/rocket-standard.svg",
  "/assets/loading/rocket-long.svg",
  "/assets/loading/rocket-standard.svg",
];

type ModalType = "settings" | "tutorial" | null;
type ScreenType = "loading" | "start" | "write" | "scan" | "assemble" | "sky" | "space" | "orbit";
type WritePhase = "drop" | "open" | "write" | "stow";
type ScanPhase = "scanning" | "exit";
type AssemblePhase = "intro" | "sort" | "stack" | "explode" | "complete" | "launch";
type PieceMotion = "arriving" | "ready" | "leaving";
type CategoryKey = "action" | "influence" | "release";
type CloudExitState = "split" | null;
type SkyItem = { category: CategoryKey; label: string };
type PieceKind =
  | "nose"
  | "left-fin"
  | "right-fin"
  | "base"
  | "gear-red"
  | "gear-yellow"
  | "gear-blue"
  | "gear-cream";
const PAPER_LINE_SLOTS = [
  { fontSize: 20, width: 222 },
  { fontSize: 17, width: 196 },
  { fontSize: 15, width: 168 },
  { fontSize: 13, width: 140 },
];
const AI_ANXIETY_PREFIX = "你在焦虑";
const AI_HOPE_PREFIX = "因为希望";
const AI_RESTATEMENT_MAX_CHARS = 32;
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  action: "\u6211\u80fd\u884c\u52a8",
  influence: "\u6211\u80fd\u5f71\u54cd",
  release: "\u6211\u7ba1\u4e0d\u4e86",
};
const ASSEMBLY_PIECES: Array<{ kind: PieceKind; label: string }> = [
  { kind: "nose", label: "\u76ee\u6807\u4e0d\u591f\u6e05\u695a" },
  { kind: "left-fin", label: "\u65f6\u95f4\u5b89\u6392\u4e0d\u7a33" },
  { kind: "right-fin", label: "\u8d44\u6599\u8fd8\u6ca1\u6536\u9f50" },
  { kind: "base", label: "\u9700\u8981\u5148\u8fc8\u51fa\u4e00\u6b65" },
  { kind: "gear-red", label: "\u522b\u4eba\u7684\u8bc4\u4ef7" },
  { kind: "gear-yellow", label: "\u7ed3\u679c\u7684\u4e0d\u786e\u5b9a" },
  { kind: "gear-blue", label: "\u6211\u80fd\u63d0\u524d\u6c9f\u901a" },
  { kind: "gear-cream", label: "\u5148\u505a\u6700\u5c0f\u7248\u672c" },
];
const DEFAULT_SKY_LABELS = ASSEMBLY_PIECES.map((piece) => piece.label);
const DEFAULT_SKY_ITEMS: SkyItem[] = ASSEMBLY_PIECES.slice(0, 4).map((piece) => ({
  category: "action",
  label: piece.label,
}));
const SKY_ADVICE = [
  "\u5148\u628a\u76ee\u6807\u5199\u6210\u4e00\u53e5\u8bdd\uff0c\u53ea\u7559\u4eca\u5929\u8981\u5b8c\u6210\u7684\u90a3\u4e00\u6b65\u3002",
  "\u7ed9\u81ea\u5df1\u7559\u4e00\u4e2a\u5c0f\u65f6\u95f4\u5757\uff0c\u5148\u505a\u6700\u7a33\u7684\u5f00\u5934\u3002",
  "\u5217\u51fa\u8fd8\u7f3a\u7684\u8d44\u6599\uff0c\u53ea\u5148\u627e\u6700\u5fc5\u8981\u7684\u4e00\u4ef6\u3002",
  "\u4e0d\u7528\u7acb\u523b\u5b8c\u7f8e\uff0c\u5148\u505a\u4e00\u4e2a\u53ef\u4ee5\u88ab\u770b\u89c1\u7684\u5c0f\u7248\u672c\u3002",
  "\u628a\u522b\u4eba\u7684\u8bc4\u4ef7\u653e\u8fdc\u4e00\u70b9\uff0c\u4f60\u53ea\u9700\u8981\u56de\u5230\u81ea\u5df1\u80fd\u63a7\u5236\u7684\u52a8\u4f5c\u3002",
  "\u7ed3\u679c\u4f1a\u6709\u53d8\u5316\uff0c\u4f46\u4f60\u53ef\u4ee5\u5148\u8bbe\u4e00\u4e2a\u53ef\u8c03\u6574\u7684\u9884\u6848\u3002",
  "\u5148\u628a\u9700\u8981\u6c9f\u901a\u7684\u4e8b\u8bf4\u6e05\u695a\uff0c\u8ba9\u4fe1\u606f\u6bd4\u60f3\u8c61\u66f4\u9760\u8c31\u3002",
  "\u9009\u6700\u5c0f\u7684\u884c\u52a8\u5f00\u59cb\uff0c\u5b8c\u6210\u4e00\u70b9\u5c31\u80fd\u7ed9\u706b\u7bad\u52a0\u4e00\u70b9\u71c3\u6599\u3002",
];
const SPACE_EXPLANATIONS = [
  "环境本来就复杂，不是你一个人能左右的。",
  "有些事需要时间自己走完，急不来。",
  "别人的决定不在你手里，放下也是一种力量。",
  "不确定性是生活的一部分，不必为它买单。",
  "有些规则你改变不了，但你可以选择怎么面对。",
  "这件事超出了你的控制范围，没关系的。",
  "世界不会因为你担心就变好，先照顾好自己。",
  "放下不是放弃，是把精力留给你能改变的事。",
];
const DEFAULT_RELEASE_ITEMS: SkyItem[] = [
  { category: "release", label: "别人的评价" },
  { category: "release", label: "结果的不确定" },
];
const DEBRIS_KINDS = ["火箭头", "左尾板", "右尾板", "壳", "底座"] as const;

export function App() {
  const [screen, setScreen] = useState<ScreenType>("loading");
  const [progress, setProgress] = useState(0);
  const [frame, setFrame] = useState(0);
  const [modal, setModal] = useState<ModalType>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const audio = useAudio(soundEnabled, musicEnabled);
  const [writePhase, setWritePhase] = useState<WritePhase>("drop");
  const [worryText, setWorryText] = useState("");
  const [scanPhase, setScanPhase] = useState<ScanPhase>("scanning");
  const [assemblePhase, setAssemblePhase] = useState<AssemblePhase>("intro");
  const [skyItems, setSkyItems] = useState<SkyItem[]>(DEFAULT_SKY_ITEMS);
  const [releaseItems, setReleaseItems] = useState<SkyItem[]>([]);
  const [aiFragments, setAiFragments] = useState<string[]>([]);
  const [aiAdviceData, setAiAdviceData] = useState<AdviceItem[]>([]);
  const [aiAnalysisData, setAiAnalysisData] = useState<AnalysisItem[]>([]);
  const [aiSummaryLines, setAiSummaryLines] = useState<string[]>([]);
  const [crisisInfo, setCrisisInfo] = useState<{ detected: boolean; message: string } | null>(null);
  const [tutorialSeen, setTutorialSeen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (screen !== "loading") {
      return;
    }

    const progressTimer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 2, 100);

        if (next === 100) {
          window.setTimeout(() => setScreen("start"), 260);
        }

        return next;
      });
    }, 34);

    const frameTimer = window.setInterval(() => {
      setFrame((current) => (current + 1) % loadingFrames.length);
    }, 140);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(frameTimer);
    };
  }, [screen]);

  const progressLabel = useMemo(
    () => `${progress.toString().padStart(2, "0")}%`,
    [progress],
  );

  if (screen === "loading") {
    return (
      <main className="loading-page" aria-label="Loading page">
        <section className="loading-stage" aria-live="polite">
          <img
            className="loading-rocket"
            src={loadingFrames[frame]}
            alt="Loading rocket"
          />
          <p className="loading-percent">{progressLabel}</p>
        </section>
      </main>
    );
  }

  const openModal = (nextModal: Exclude<ModalType, null>) => {
    audio.play("click");
    setModal(nextModal);
  };

  const closeModal = () => {
    audio.play("click");
    setModal(null);
  };

  const launch = () => {
    audio.play("click");
    setModal(null);
    setIsLaunching(true);
    audio.play("launch");
    window.setTimeout(() => {
      setScreen("write");
      setWritePhase("drop");
      setWorryText("");
    }, 1450);
  };

  if (screen === "write") {
    return (
      <>
      <WriteScreen
        onOpenCapsule={() => {
          if (writePhase !== "drop") {
            return;
          }
          audio.play("click");
          audio.play("capsuleDrop");
          setWritePhase("open");
          window.setTimeout(() => {
            audio.play("unroll");
            setWritePhase("write");
          }, 950);
        }}
        onSubmit={() => {
          audio.play("click");
          audio.stop("typing");
          const crisis = checkCrisis(worryText);
          if (crisis) {
            setCrisisInfo(crisis);
            return;
          }
          setWritePhase("stow");
          window.setTimeout(() => {
            setScanPhase("scanning");
            setScreen("scan");
          }, 760);
        }}
        phase={writePhase}
        text={worryText}
        onTextChange={setWorryText}
        audio={audio}
      />
      {crisisInfo && (
        <div className="modal-layer crisis-layer" onClick={() => setCrisisInfo(null)}>
          <div className="crisis-card" onClick={(e) => e.stopPropagation()}>
            <img className="crisis-star crisis-star-1" src="/assets/p6/背景装饰红色星星.svg" alt="" />
            <img className="crisis-star crisis-star-2" src="/assets/p6/背景装饰黄色星星.svg" alt="" />
            <div className="crisis-body">
              <p className="crisis-title">你不是一个人</p>
              <p className="crisis-subtitle">如果你正在经历困难的时刻，请拨打专业援助热线，会有人陪着你。</p>
              <a className="crisis-hotline" href="tel:4006525580">
                <span className="crisis-phone-icon">✆</span>
                <span className="crisis-phone-number">400-652-5580</span>
              </a>
              <p className="crisis-hotline-label">希望24热线（全天候）</p>
            </div>
            <button className="crisis-close-btn" type="button" onClick={() => setCrisisInfo(null)}>返回</button>
          </div>
        </div>
      )}
      </>
    );
  }

  if (screen === "scan") {
    return (
      <ScanScreen
        onConfirm={(finalSummary: string) => {
          audio.play("click");
          setScanPhase("exit");
          aiSplit(finalSummary)
            .then((frags) => setAiFragments(frags.length ? frags : ASSEMBLY_PIECES.map((p) => p.label)))
            .catch(() => setAiFragments(ASSEMBLY_PIECES.map((p) => p.label)));
          window.setTimeout(() => {
            setAssemblePhase("intro");
            setScreen("assemble");
          }, 1680);
        }}
        phase={scanPhase}
        sourceText={worryText}
        audio={audio}
        showTutorial={!tutorialSeen.scan}
        onDismissTutorial={() => setTutorialSeen((s) => ({ ...s, scan: true }))}
      />
    );
  }

  if (screen === "assemble") {
    return (
      <AssembleScreen
        phase={assemblePhase}
        onPhaseChange={setAssemblePhase}
        onLaunchComplete={(items, released) => {
          setSkyItems(items);
          setReleaseItems(released);
          const actionInfluenceLabels = items.map((i) => i.label);
          const releaseLabels = released.map((i) => i.label);
          aiAdvice(actionInfluenceLabels)
            .then((data) => setAiAdviceData(data))
            .catch(() => setAiAdviceData([]));
          aiAnalyze(releaseLabels)
            .then((data) => setAiAnalysisData(data))
            .catch(() => setAiAnalysisData([]));
          setScreen("sky");
        }}
        fragmentLabels={aiFragments}
        audio={audio}
      />
    );
  }

  if (screen === "sky") {
    return <SkyScreen items={skyItems} onComplete={() => setScreen("space")} onRocketBurst={() => audio.play("rocketBurst")} adviceData={aiAdviceData} showTutorial={!tutorialSeen.sky} onDismissTutorial={() => setTutorialSeen((s) => ({ ...s, sky: true }))} />;
  }

  if (screen === "space") {
    return <SpaceScreen items={releaseItems} onComplete={() => {
      audio.switchToEnding();
      const context = `用户焦虑：${worryText}\n行动碎片：${skyItems.map((i) => i.label).join("、")}\n释放碎片：${releaseItems.map((i) => i.label).join("、")}`;
      aiSummarize(context)
        .then((lines) => setAiSummaryLines(lines.length ? lines : MOCK_SUMMARY))
        .catch(() => setAiSummaryLines(MOCK_SUMMARY));
      setScreen("orbit");
    }} audio={audio} analysisData={aiAnalysisData} showTutorial={!tutorialSeen.space} onDismissTutorial={() => setTutorialSeen((s) => ({ ...s, space: true }))} />;
  }

  if (screen === "orbit") {
    return <OrbitScreen summaryLines={aiSummaryLines} />;
  }

  return (
    <main className="start-page" aria-label="Start page">
      <section className={`start-stage ${isLaunching ? "is-launching" : ""}`}>
        <img className="start-decor start-red-star" src="/assets/p6/背景装饰红色星星.svg" alt="" />
        <img className="start-decor start-yellow-star" src="/assets/p6/背景装饰黄色星星.svg" alt="" />
        <div className="title-stack" aria-hidden="true">
          <img
            className="sticker-title sticker-anxiety"
            src="/assets/p1/title-jiao-lv.svg"
            alt=""
          />
          <img
            className="sticker-title sticker-ship"
            src="/assets/p1/title-chai-jie-hao.svg"
            alt=""
          />
        </div>

        <button
          className="start-button pressable"
          type="button"
          aria-label="Start"
          onClick={launch}
          disabled={isLaunching}
        >
          <img src="/assets/p1/start.svg" alt="" />
        </button>

        <img
          className="hero-rocket"
          src="/assets/p1/hero-rocket.svg"
          alt="Rocket"
        />

        <div className="corner-buttons" aria-label="Panels">
          <button
            className={`asset-button pressable ${
              modal === "settings" ? "is-selected" : ""
            }`}
            type="button"
            aria-label="Settings"
            onClick={() => openModal("settings")}
          >
            <img
              src={
                modal === "settings"
                  ? "/assets/p1/settings-on.svg"
                  : "/assets/p1/settings-off.svg"
              }
              alt=""
            />
          </button>
          <button
            className={`asset-button pressable ${
              modal === "tutorial" ? "is-selected" : ""
            }`}
            type="button"
            aria-label="Tutorial"
            onClick={() => openModal("tutorial")}
          >
            <img
              src={
                modal === "tutorial"
                  ? "/assets/p1/tutorial-on.svg"
                  : "/assets/p1/tutorial-off.svg"
              }
              alt=""
            />
          </button>
        </div>

        {modal && (
          <section className="modal-layer" aria-label={`${modal} panel`}>
            <button
              className="modal-scrim"
              type="button"
              aria-label="Close panel"
              onClick={closeModal}
            />

            {modal === "settings" ? (
              <SettingsPanel
                musicEnabled={musicEnabled}
                onClose={closeModal}
                onToggleMusic={() => { audio.play("click"); setMusicEnabled((current) => !current); }}
                onToggleSound={() => { audio.play("click"); setSoundEnabled((current) => !current); }}
                soundEnabled={soundEnabled}
              />
            ) : (
              <TutorialPanel onClose={closeModal} />
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function SettingsPanel({
  musicEnabled,
  onClose,
  onToggleMusic,
  onToggleSound,
  soundEnabled,
}: {
  musicEnabled: boolean;
  onClose: () => void;
  onToggleMusic: () => void;
  onToggleSound: () => void;
  soundEnabled: boolean;
}) {
  return (
    <div className="settings-panel modal-panel">
      <img className="panel-bg" src="/assets/p1/settings-panel.svg" alt="" />
      <img
        className="setting-icon volume-icon"
        src="/assets/p1/volume.svg"
        alt=""
      />
      <img
        className="setting-icon music-icon"
        src="/assets/p1/music.svg"
        alt=""
      />
      <button
        className={`setting-toggle sound-toggle pressable ${
          soundEnabled ? "is-on" : "is-off"
        }`}
        type="button"
        aria-label="Toggle sound"
        aria-pressed={soundEnabled}
        onClick={onToggleSound}
      >
        <img
          className="toggle-track"
          src={
            soundEnabled
              ? "/assets/p1/toggle-on.svg"
              : "/assets/p1/toggle-off.svg"
          }
          alt=""
        />
        <span className="toggle-knob" aria-hidden="true" />
      </button>
      <button
        className={`setting-toggle music-toggle pressable ${
          musicEnabled ? "is-on" : "is-off"
        }`}
        type="button"
        aria-label="Toggle music"
        aria-pressed={musicEnabled}
        onClick={onToggleMusic}
      >
        <img
          className="toggle-track"
          src={
            musicEnabled
              ? "/assets/p1/toggle-on.svg"
              : "/assets/p1/toggle-off.svg"
          }
          alt=""
        />
        <span className="toggle-knob" aria-hidden="true" />
      </button>
      <button
        className="close-button pressable"
        type="button"
        aria-label="Close settings"
        onClick={onClose}
      >
        <img src="/assets/p1/close.svg" alt="" />
      </button>
    </div>
  );
}

function TutorialPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="tutorial-panel modal-panel">
      <img className="panel-bg" src="/assets/p1/tutorial-panel.svg" alt="" />
      <div className="about-content">
        <h3 className="about-title">小火箭焦虑拆解</h3>
        <p className="about-desc">一款帮助你拆解焦虑、梳理情绪的互动小工具。写下困扰你的事，AI 会帮你拆解成可行动的碎片，让焦虑变得具体、可控。</p>
        <p className="about-disclaimer">本产品仅供情绪梳理参考，不构成心理咨询或医疗建议。如你正在经历严重的心理困扰，请及时联系专业心理援助热线。</p>
        <p className="about-credits">BGM: "Crystal Clear" by TipTopTomCat</p>
      </div>
      <button
        className="close-button tutorial-close pressable"
        type="button"
        aria-label="Close panel"
        onClick={onClose}
      >
        <img src="/assets/p1/close.svg" alt="" />
      </button>
    </div>
  );
}

function WriteScreen({
  onOpenCapsule,
  onSubmit,
  onTextChange,
  phase,
  text,
  audio,
}: {
  onOpenCapsule: () => void;
  onSubmit: () => void;
  onTextChange: (value: string) => void;
  phase: WritePhase;
  text: string;
  audio: AudioManager;
}) {
  const typingStarted = useRef(false);
  const handleTextChange = (val: string) => {
    if (!typingStarted.current && val.length > 0) {
      audio.play("typing", { loop: true, volume: 0.3 });
      typingStarted.current = true;
    }
    if (val.length === 0) {
      audio.stop("typing");
      typingStarted.current = false;
    }
    onTextChange(val);
  };
  const isPaperVisible = phase === "write";
  const paperLines = buildPaperLines(text);
  const activeLineIndex = paperLines.length - 1;

  return (
    <main className="write-page" aria-label="Write page">
      <section className={`write-stage phase-${phase}`}>
        <div className="impact-burst" aria-hidden="true">
          <span className="burst-line line-a" />
          <span className="burst-line line-b" />
          <span className="burst-line line-c" />
          <img className="burst-star yellow-star" src="/assets/p2/yellow-star.svg" alt="" />
          <img className="burst-star red-star" src="/assets/p2/red-star.svg" alt="" />
        </div>

        <img className="click-hint" src="/assets/p2/click.svg" alt="" />

        <button
          className="capsule-wrap"
          type="button"
          aria-label="Open capsule"
          onClick={onOpenCapsule}
          disabled={phase !== "drop"}
        >
          <img
            className="capsule capsule-closed"
            src={
              phase === "stow"
                ? "/assets/p3/capsule-paper.svg"
                : "/assets/p2/capsule-closed.svg"
            }
            alt=""
          />
          <img
            className="capsule capsule-open"
            src="/assets/p2/capsule-open-paper.svg"
            alt=""
          />
        </button>

        {isPaperVisible && (
          <button
            className="paper-button"
            type="button"
            aria-label="Put paper back into capsule"
            onClick={onSubmit}
            onPointerUp={onSubmit}
          >
            <img className="paper-scroll" src="/assets/p2/paper-open.svg" alt="" />
          </button>
        )}

        {isPaperVisible && (
          <div className="paper-type-area">
            <div className="paper-lines" aria-hidden="true">
              {paperLines.map((line, index) => (
                <div
                  className="paper-line"
                  data-age={paperLines.length - 1 - index}
                  key={`${line}-${index}`}
                >
                  {line}
                  {index === activeLineIndex && (
                    <span className="paper-caret" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
            <textarea
              className="worry-input"
              placeholder=""
              value={text}
              onChange={(event) => handleTextChange(event.target.value)}
              aria-label="Write your anxiety"
              autoFocus
            />
          </div>
        )}

        {isPaperVisible && (
          <button
            className="paper-submit-zone"
            type="button"
            aria-label="Put paper back into capsule"
            onClick={onSubmit}
            onPointerUp={onSubmit}
          />
        )}

        {isPaperVisible && (
          <>
            <img className="write-pen" src="/assets/p2/pen.svg" alt="" />
            <img
              className="write-prompt"
              src="/assets/p2/write-your-anxiety.svg"
              alt="Write your anxiety"
            />
            <p className="write-tip">写完点击纸张收起</p>
          </>
        )}
      </section>
    </main>
  );
}

function ScanScreen({
  onConfirm,
  phase,
  sourceText,
  audio,
  showTutorial,
  onDismissTutorial,
}: {
  onConfirm: (summary: string) => void;
  phase: ScanPhase;
  sourceText: string;
  audio: AudioManager;
  showTutorial: boolean;
  onDismissTutorial: () => void;
}) {
  const [scanProgress, setScanProgress] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const [aiSummary, setAiSummary] = useState("");
  const [aiReady, setAiReady] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const summaryInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase !== "scanning") return;

    setScanProgress(0);
    setTypedLength(0);
    setAiReady(false);
    setIsEditingSummary(false);
    audio.play("scan", { loop: true, volume: 0.15 });

    const progressTimer = window.setInterval(() => {
      setScanProgress((current) => Math.min(current + 1, 6));
    }, 360);

    let cancelled = false;
    aiRestate(sourceText)
      .then((summary) => { if (!cancelled) { setAiSummary(summary || makeMockAiSummary(sourceText)); setAiReady(true); } })
      .catch(() => { if (!cancelled) { setAiSummary(makeMockAiSummary(sourceText)); setAiReady(true); } });

    return () => { cancelled = true; window.clearInterval(progressTimer); audio.stop("scan"); };
  }, [phase, sourceText]);

  useEffect(() => {
    if (phase !== "scanning" || scanProgress < 6 || !aiReady || isEditingSummary) {
      return;
    }

    audio.play("typing", { loop: true, volume: 0.3 });

    const typeTimer = window.setInterval(() => {
      setTypedLength((current) => {
        if (current >= aiSummary.length) {
          window.clearInterval(typeTimer);
          audio.stop("typing");
          return current;
        }

        return current + 1;
      });
    }, 58);

    return () => { window.clearInterval(typeTimer); audio.stop("typing"); };
  }, [aiSummary, isEditingSummary, phase, scanProgress]);

  useEffect(() => {
    if (!isEditingSummary) {
      return;
    }

    const input = summaryInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [isEditingSummary]);

  const completedSegments = Math.max(1, scanProgress);
  const typedSummary = isEditingSummary ? aiSummary : aiSummary.slice(0, typedLength);
  const displaySummary = splitAiSummaryForDisplay(typedSummary);

  if (phase === "exit") {
    return <ScanToAssembleBridge />;
  }

  return (
    <main className="scan-page" aria-label="Scan page">
      <section className={`scan-stage phase-${phase}`}>
        <img className="conveyor-bottom" src="/assets/p3/conveyor-bottom.svg" alt="" />

        <div className="scan-ui">
          <img className="scanner-top" src="/assets/p3/scanner.svg" alt="" />
          <div className="scan-chamber" aria-hidden="true">
            <img className="scan-zone" src="/assets/p3/scan-zone.svg" alt="" />
            <span className="scan-beam" />
          </div>
          <img className="beep beep-left" src="/assets/p3/beep.svg" alt="" />
          <img className="beep beep-right" src="/assets/p3/beep.svg" alt="" />
        </div>

        <img className="scan-capsule" src="/assets/p3/capsule-paper.svg" alt="" />

        <section className="scan-readout" aria-live="polite">
          <div className="scan-status">
            <img src="/assets/p3/scanning-label.svg" alt="Scanning" />
            <div className="progress-bars" aria-label={`${completedSegments} of 6`}>
              {Array.from({ length: 6 }).map((_, index) => (
                <img
                  key={index}
                  src={
                    index < completedSegments
                      ? "/assets/p3/progress-on.svg"
                      : "/assets/p3/progress-off.svg"
                  }
                  alt=""
                />
              ))}
            </div>
          </div>

          <div className={`ai-lines ${isEditingSummary ? "is-editing" : ""}`}>
            <div className="ai-line ai-line-anxiety">
              <img src="/assets/p3/you-are-anxious.svg" alt="" />
              <span>{displaySummary.anxiety}</span>
            </div>
            <div className="ai-line ai-line-hope">
              <img src="/assets/p3/because-hope.svg" alt="" />
              <span>{displaySummary.hope}</span>
            </div>
            {isEditingSummary && (
              <div className="ai-edit-panel">
                <textarea
                  ref={summaryInputRef}
                  className="ai-edit-textarea"
                  aria-label="Edit AI summary"
                  autoFocus
                  inputMode="text"
                  maxLength={AI_RESTATEMENT_MAX_CHARS}
                  rows={2}
                  spellCheck={false}
                  value={aiSummary}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  onChange={(event) => {
                    const nextText = event.target.value
                      .replace(/\s+/g, "")
                      .slice(0, AI_RESTATEMENT_MAX_CHARS);
                    setAiSummary(nextText);
                    setTypedLength(nextText.length);
                  }}
                />
                <button
                  className="ai-edit-confirm pressable"
                  type="button"
                  onClick={() => {
                    setTypedLength(aiSummary.length);
                    setIsEditingSummary(false);
                  }}
                >
                  确认
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="scan-buttons">
          <button
            className="asset-button scan-action pressable"
            type="button"
            aria-label="Edit"
            onClick={() => {
              setTypedLength(aiSummary.length);
              setIsEditingSummary((current) => !current);
            }}
          >
            <img src="/assets/p3/edit-button.svg" alt="" />
          </button>
          <button className="asset-button scan-action pressable" type="button" aria-label="Confirm" onClick={() => onConfirm(aiSummary)}>
            <img src="/assets/p3/confirm-button.svg" alt="" />
          </button>
          <button
            className="asset-button scan-action pressable"
            type="button"
            aria-label="Retry"
            onClick={() => {
              setIsEditingSummary(false);
              setAiReady(false);
              setScanProgress(0);
              setTypedLength(0);
              aiRestate(sourceText)
                .then((s) => { setAiSummary(s || makeMockAiSummary(sourceText)); setAiReady(true); })
                .catch(() => { setAiSummary(makeMockAiSummary(sourceText)); setAiReady(true); });
            }}
          >
            <img src="/assets/p3/retry-button.svg" alt="" />
          </button>
        </div>

        {showTutorial && typedLength > 0 && !isEditingSummary && (
          <div className="tutorial-overlay" onClick={onDismissTutorial}>
            <div className="tutorial-hint hint-edit">
              <p>修改</p>
              <div className="hint-arrow hint-arrow-down" />
            </div>
            <div className="tutorial-hint hint-confirm">
              <p>确认</p>
              <div className="hint-arrow hint-arrow-down" />
            </div>
            <div className="tutorial-hint hint-retry">
              <p>重说</p>
              <div className="hint-arrow hint-arrow-down" />
            </div>
            <p className="tutorial-dismiss">点击任意处关闭</p>
          </div>
        )}
      </section>
    </main>
  );
}

function ScanToAssembleBridge() {
  return (
    <main className="scan-page" aria-label="Scan to assembly transition">
      <section className="scan-stage phase-exit">
        <div className="scan-bridge-canvas" aria-hidden="true">
          <div className="scan-bridge-p4">
            <Conveyor />
            <section className="sort-panel bridge-sort-panel">
              <img className="sort-panel-bg" src={p4Asset("传送带面板")} alt="" />
              <div className="category-buttons">
                {(["action", "influence", "release"] as CategoryKey[]).map((category) => (
                  <div className="category-button" key={category}>
                    <img src={p4Asset(CATEGORY_LABELS[category])} alt="" />
                  </div>
                ))}
              </div>
              <img className="sort-edit-button" src={p4Asset("编辑")} alt="" />
            </section>
          </div>

          <div className="scan-bridge-p3">
            <img className="scan-bridge-capsule" src={p4Asset("舱体")} alt="" />
          </div>
        </div>
      </section>
    </main>
  );
}

function AssembleScreen({
  onPhaseChange,
  onLaunchComplete,
  phase,
  audio,
  fragmentLabels,
}: {
  onLaunchComplete: (items: SkyItem[], released: SkyItem[]) => void;
  onPhaseChange: (phase: AssemblePhase) => void;
  phase: AssemblePhase;
  audio: AudioManager;
  fragmentLabels: string[];
}) {
  const pieces = useMemo(() => {
    const labels = fragmentLabels.length > 0 ? fragmentLabels : ASSEMBLY_PIECES.map((p) => p.label);
    return labels.map((label, i) => ({
      kind: ASSEMBLY_PIECES[i % ASSEMBLY_PIECES.length].kind,
      label,
    }));
  }, [fragmentLabels]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [pieceLabels, setPieceLabels] = useState(
    () => pieces.map((p) => p.label),
  );
  const [selectedCategories, setSelectedCategories] = useState<Array<CategoryKey | null>>(
    () => pieces.map(() => null),
  );
  const [isEditingPiece, setIsEditingPiece] = useState(false);
  const [draftLabel, setDraftLabel] = useState(pieceLabels[0]);
  const [pieceMotion, setPieceMotion] = useState<PieceMotion>("arriving");

  const activePiece = pieces[activeIndex];

  useEffect(() => {
    setPieceLabels(pieces.map((p) => p.label));
    setSelectedCategories(pieces.map(() => null));
  }, [pieces]);

  useEffect(() => {
    if (phase !== "intro") {
      return;
    }

    const timer = window.setTimeout(() => onPhaseChange("sort"), 2360);
    return () => window.clearTimeout(timer);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    if (phase !== "sort") {
      return;
    }

    setPieceMotion("arriving");
    const timer = window.setTimeout(() => setPieceMotion("ready"), 2300);
    return () => window.clearTimeout(timer);
  }, [activeIndex, phase]);

  useEffect(() => {
    if (phase === "intro" || phase === "sort") {
      audio.play("conveyor", { loop: true, volume: 0.15 });
      return () => audio.stop("conveyor");
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "stack") {
      return;
    }

    audio.play("assemble", { volume: 0.5 });
    const timer = window.setTimeout(() => onPhaseChange("explode"), 2200);
    return () => window.clearTimeout(timer);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    if (phase !== "explode") {
      return;
    }

    const timer = window.setTimeout(() => onPhaseChange("complete"), 3800);
    return () => window.clearTimeout(timer);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    setDraftLabel(pieceLabels[activeIndex]);
    setIsEditingPiece(false);
  }, [activeIndex, pieceLabels]);

  const chooseCategory = (category: CategoryKey) => {
    if (pieceMotion !== "ready") {
      return;
    }

    audio.play("click");
    const nextCategories = [...selectedCategories];
    nextCategories[activeIndex] = category;
    setSelectedCategories(nextCategories);
    setPieceMotion("leaving");

    window.setTimeout(() => {
      if (activeIndex >= pieces.length - 1) {
        onPhaseChange("stack");
        return;
      }

      setActiveIndex((current) => current + 1);
    }, 720);
  };

  const savePieceLabel = () => {
    const nextLabels = [...pieceLabels];
    nextLabels[activeIndex] = draftLabel.trim() || pieceLabels[activeIndex];
    setPieceLabels(nextLabels);
    setIsEditingPiece(false);
  };

  const launchToSky = () => {
    audio.play("click");
    audio.play("launch");
    const allItems = pieceLabels.map((label, index) => ({
      category: selectedCategories[index],
      label,
    }));
    const nextSkyItems = allItems.filter(
      (item): item is SkyItem => item.category === "action" || item.category === "influence",
    );
    const nextReleaseItems = allItems.filter(
      (item): item is SkyItem => item.category === "release",
    );

    onPhaseChange("launch");
    window.setTimeout(() => onLaunchComplete(nextSkyItems, nextReleaseItems), 1120);
  };

  return (
    <main className="assemble-page" aria-label="Assembly page">
      <section className={`assemble-stage phase-${phase}`}>
        {(phase === "intro" || phase === "sort") && <Conveyor />}

        {phase === "intro" && (
          <>
            <img className="p4-capsule departing-capsule" src={p4Asset("舱体")} alt="" />
            <section className="sort-panel intro-sort-panel" aria-hidden="true">
              <img className="sort-panel-bg" src={p4Asset("传送带面板")} alt="" />
              <div className="category-buttons">
                {(["action", "influence", "release"] as CategoryKey[]).map((category) => (
                  <div className="category-button" key={category}>
                    <img src={p4Asset(CATEGORY_LABELS[category])} alt="" />
                  </div>
                ))}
              </div>
              <img className="sort-edit-button" src={p4Asset("编辑")} alt="" />
            </section>
          </>
        )}

        {phase === "sort" && activePiece && (
          <>
            <div className="piece-lane" aria-hidden="true">
              <PieceImage
                kind={activePiece.kind}
                className={`travel-piece piece-${pieceMotion}`}
                key={`${activePiece.kind}-${activeIndex}`}
              />
            </div>

            <section className="sort-panel" aria-live="polite">
              <img className="sort-panel-bg" src={p4Asset("传送带面板")} alt="" />
              <div className={`piece-label-box ${pieceMotion === "ready" ? "is-visible" : ""}`}>
                {isEditingPiece ? (
                  <div className="piece-edit-box">
                    <textarea
                      value={draftLabel}
                      maxLength={12}
                      rows={1}
                      aria-label="Edit fragment label"
                      onChange={(event) => setDraftLabel(event.target.value.replace(/\s+/g, ""))}
                    />
                    <button className="piece-edit-save pressable" type="button" onClick={savePieceLabel}>
                      OK
                    </button>
                  </div>
                ) : (
                  <span>{pieceLabels[activeIndex]}</span>
                )}
              </div>

              <div className="category-buttons">
                {(["action", "influence", "release"] as CategoryKey[]).map((category) => (
                  <button
                    className={`category-button pressable ${
                      selectedCategories[activeIndex] === category ? "is-selected" : ""
                    }`}
                    type="button"
                    key={category}
                    aria-label={CATEGORY_LABELS[category]}
                    onClick={() => chooseCategory(category)}
                  >
                    <img src={p4Asset(CATEGORY_LABELS[category])} alt="" />
                  </button>
                ))}
              </div>

              <button
                className="sort-edit-button pressable"
                type="button"
                aria-label="Edit fragment"
                onClick={() => setIsEditingPiece((current) => !current)}
              >
                <img src={p4Asset("编辑")} alt="" />
              </button>
            </section>
          </>
        )}

        {(phase === "stack" || phase === "explode" || phase === "complete" || phase === "launch") && (
          <img className="stack-conveyor-edge" src={p4Asset("传送带上边缘")} alt="" />
        )}

        {(phase === "stack" || phase === "explode") && (
          <img className="component-stack" src={p4Asset("组件堆")} alt="" />
        )}

        {phase === "explode" && (
          <div className="explosion-scene" aria-hidden="true">
            <img className="total-explosion" src={p4Asset("总爆炸")} alt="" />
            <img className="explosion-boom boom-blue" src={p4Asset("蓝boom")} alt="" />
            <img className="explosion-boom boom-yellow" src={p4Asset("黄boom")} alt="" />
            <img className="explosion-fly-gear gear-one" src={p4Asset("蓝色弹飞齿轮")} alt="" />
            <img className="explosion-fly-gear gear-two" src={p4Asset("米色弹飞齿轮")} alt="" />
            <img className="explosion-fly-star star-one" src={p4Asset("黄色弹出星星")} alt="" />
            <span className="explosion-ray ray-one" />
            <span className="explosion-ray ray-two" />
            <span className="explosion-ray ray-three" />
          </div>
        )}

        {(phase === "complete" || phase === "launch") && (
          <section className="complete-scene">
            <img className="wow-word" src={p4Asset("wow")} alt="" />
            <img className="complete-star" src={p4Asset("黄色装饰星星")} alt="" />
            <div className="complete-rocket-wrap">
              <img className="complete-rocket" src={p4Asset("组装完成火箭")} alt="" />
              <img className="rocket-flame" src={p4Asset("尾焰")} alt="" />
            </div>
            <button
              className="launch-button pressable"
              type="button"
              aria-label="Launch"
              onClick={launchToSky}
              disabled={phase === "launch"}
            >
              <img src={p4Asset("发射按钮")} alt="" />
            </button>
          </section>
        )}
      </section>
    </main>
  );
}

function SkyScreen({ items, onComplete, onRocketBurst, adviceData, showTutorial, onDismissTutorial }: { items: SkyItem[]; onComplete: () => void; onRocketBurst?: () => void; adviceData: AdviceItem[]; showTutorial: boolean; onDismissTutorial: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [exitState, setExitState] = useState<CloudExitState>(null);
  const [isBoosting, setIsBoosting] = useState(false);
  const blueStartX = useRef<number | null>(null);
  const redStartX = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const cloudItems = items.length ? items : DEFAULT_SKY_ITEMS;
  const currentLabel = cloudItems[activeIndex]?.label || DEFAULT_SKY_LABELS[activeIndex] || "";
  const fallbackTips = ["写下目标", "留时间块", "列清单", "做小版本", "放远评价", "设预案", "说清楚", "最小行动"];
  const currentTip = adviceData[activeIndex]?.tip || fallbackTips[activeIndex] || fallbackTips[fallbackTips.length - 1];
  const currentDetail = adviceData[activeIndex]?.detail || SKY_ADVICE[activeIndex] || SKY_ADVICE[SKY_ADVICE.length - 1];
  const isFinished = activeIndex >= cloudItems.length;

  useEffect(() => {
    if (!isFinished) return;
    const timer = window.setTimeout(onComplete, 1200);
    return () => window.clearTimeout(timer);
  }, [isFinished, onComplete]);

  const dismissClouds = () => {
    if (exitState || isFinished) {
      return;
    }

    setExitState("split");
    setIsBoosting(true);
    onRocketBurst?.();

    window.setTimeout(() => {
      setActiveIndex((current) => current + 1);
      setIsExpanded(false);
      setExitState(null);
    }, 520);

    window.setTimeout(() => setIsBoosting(false), 760);
  };

  const handleBluePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    blueStartX.current = event.clientX;
    didSwipe.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBluePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (blueStartX.current === null) {
      return;
    }

    const distance = event.clientX - blueStartX.current;
    blueStartX.current = null;

    if (distance > -42) {
      return;
    }

    didSwipe.current = true;
    dismissClouds();
  };

  const handleRedPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    redStartX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleRedPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (redStartX.current === null) {
      return;
    }

    const distance = event.clientX - redStartX.current;
    redStartX.current = null;

    if (distance < 42) {
      return;
    }

    dismissClouds();
  };

  const toggleAdvice = () => {
    if (didSwipe.current || exitState || isFinished) {
      didSwipe.current = false;
      return;
    }

    setIsExpanded((current) => !current);
  };

  return (
    <main className="sky-page" aria-label="Advice clouds page">
      <section className="sky-stage">
        <div className="sky-camera-canvas">
          <div className="sky-scene">
            <img className="sky-decor blue-planet" src={p5Asset("背景装饰蓝色星球")} alt="" />
            <img className="sky-decor black-planet" src={p5Asset("完整黑色星球")} alt="" />

            {!isFinished && (
              <div className={`cloud-pair ${isExpanded ? "is-expanded" : ""} ${exitState ? "exit-split" : ""}`}>
                <button
                  className="advice-cloud pressable"
                  type="button"
                  onClick={toggleAdvice}
                  onPointerDown={handleBluePointerDown}
                  onPointerUp={handleBluePointerUp}
                >
                  <img src={p5Asset(isExpanded ? "蓝色展开云" : "蓝色云")} alt="" />
                  <span className="advice-text">
                    {isExpanded ? (
                      <>
                        <span>{currentTip}</span>
                        <span>{currentDetail}</span>
                      </>
                    ) : (
                      currentTip
                    )}
                  </span>
                </button>

                <div
                  className="fragment-cloud"
                  aria-label={currentLabel}
                  onPointerDown={handleRedPointerDown}
                  onPointerUp={handleRedPointerUp}
                >
                  <img src={p5Asset("红色云")} alt="" />
                  <span>{currentLabel}</span>
                </div>
              </div>
            )}

            <img
              className={`sky-decor red-star-decor ${isBoosting ? "is-boosting" : ""}`}
              src={p5Asset("背景装饰红色星星")}
              alt=""
            />
            <img
              className={`sky-decor yellow-star-decor ${isBoosting ? "is-boosting" : ""}`}
              src={p5Asset("背景装饰黄色星星")}
              alt=""
            />

            <div className={`sky-rocket-wrap ${isBoosting ? "is-boosting" : ""} ${isFinished ? "is-exiting" : ""}`}>
              <img className="sky-rocket" src={p5Asset("火箭")} alt="" />
              <img className="sky-flame" src={p5Asset("尾焰")} alt="" />
            </div>
          </div>

          <div className="sky-bridge-scene" aria-hidden="true">
            <div className="sky-bridge-rocket-wrap">
              <img className="sky-bridge-rocket" src={p5Asset("火箭")} alt="" />
              <img className="sky-bridge-flame" src={p5Asset("尾焰")} alt="" />
            </div>
          </div>
        </div>

        {showTutorial && !isFinished && (
          <div className="tutorial-overlay" onClick={onDismissTutorial}>
            <div className="tutorial-hint hint-sky-tap">
              <p>点击蓝色云朵查看建议</p>
              <div className="hint-arrow hint-arrow-down" />
            </div>
            <div className="tutorial-hint hint-sky-swipe">
              <p>向左划红色云朵消除焦虑</p>
              <div className="hint-arrow hint-arrow-down" />
            </div>
            <p className="tutorial-dismiss">点击任意处关闭</p>
          </div>
        )}
      </section>
    </main>
  );
}

function SpaceScreen({ items, onComplete, audio, analysisData, showTutorial, onDismissTutorial }: { items: SkyItem[]; onComplete: () => void; audio: AudioManager; analysisData: AnalysisItem[]; showTutorial: boolean; onDismissTutorial: () => void }) {
  const debrisItems = items.length ? items : DEFAULT_RELEASE_ITEMS;
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const scrollDuration = 8 + debrisItems.length * 3;

  useEffect(() => {
    const timer = window.setTimeout(onComplete, (scrollDuration + 2) * 1000);
    return () => window.clearTimeout(timer);
  }, [scrollDuration, onComplete]);

  const handlePointerDown = (idx: number) => { audio.play("click"); setFocusedIdx(idx); };
  const handlePointerUp = () => setFocusedIdx(null);

  return (
    <main
      className={`space-page${focusedIdx !== null ? " debris-focus-active" : ""}`}
      aria-label="Release page"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <section className="space-stage">
        <div className="space-camera-canvas">
          <div className="space-scene">
            <img className="space-decor space-blue-planet" src={p6Asset("背景装饰蓝色星球")} alt="" />
            <img className="space-decor space-red-star" src={p6Asset("背景装饰红色星星")} alt="" />
            <img className="space-decor space-yellow-star" src={p6Asset("背景装饰黄色星星")} alt="" />

            <div
              className="space-credits-track"
              style={{ animationDuration: `${scrollDuration}s` }}
            >
              <div className="satellite-wrap">
                <img className="satellite" src={p6Asset("卫星")} alt="Satellite" />
              </div>

              {debrisItems.map((item, index) => {
                const debrisKind = DEBRIS_KINDS[index % DEBRIS_KINDS.length];
                const isLeft = index % 2 === 0;
                const explanation = analysisData[index]?.comfort || SPACE_EXPLANATIONS[index] || SPACE_EXPLANATIONS[SPACE_EXPLANATIONS.length - 1];
                return (
                  <div
                    className={`debris-row ${isLeft ? "debris-left" : "debris-right"}${focusedIdx === index ? " debris-focused" : ""}`}
                    key={index}
                    onPointerDown={() => handlePointerDown(index)}
                  >
                    <img className="debris-img" src={p6Asset(debrisKind)} alt="" />
                    <div className="debris-text-box">
                      <span className="debris-label">{item.label}</span>
                      <span className="debris-explanation">{explanation}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-bridge-scene" aria-hidden="true">
            <img className="space-bridge-black-planet" src={p6Asset("完整黑色星球")} alt="" />
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-overlay" onClick={onDismissTutorial}>
            <div className="tutorial-hint hint-space-hold">
              <p>长按碎片可以定格查看</p>
            </div>
            <p className="tutorial-dismiss">点击任意处关闭</p>
          </div>
        )}
      </section>
    </main>
  );
}

const MOCK_SUMMARY = [
  "一些总结性的话",
  "诗意一点",
  "占位",
];

function OrbitScreen({ summaryLines }: { summaryLines: string[] }) {
  const lines = summaryLines.length ? summaryLines : MOCK_SUMMARY;
  return (
    <main className="orbit-page" aria-label="Ending page">
      <section className="orbit-stage">
        <div className="orbit-camera-canvas">
          <div className="orbit-scene">
            <div className="orbit-planet-wrap">
              <img className="orbit-planet" src={p7Asset("星球")} alt="Planet" />
              <img className="orbit-ring" src={p7Asset("星环")} alt="" />
              <img className="orbit-satellite" src={p7Asset("卫星")} alt="Satellite" />
            </div>

            <div className="orbit-summary">
              {lines.map((line, i) => (
                <p className="orbit-summary-line" key={i} style={{ animationDelay: `${2.5 + i * 0.6}s` }}>
                  {line}
                </p>
              ))}
            </div>

            <img className="orbit-end" src={p7Asset("end")} alt="END." style={{ animationDelay: "5s" }} />
          </div>

          <div className="orbit-bridge-scene" aria-hidden="true">
            <img className="orbit-bridge-planet" src={p6Asset("完整黑色星球")} alt="" />
          </div>
        </div>
      </section>
    </main>
  );
}

function Conveyor() {
  return (
    <div className="p4-conveyor-wrap" aria-hidden="true">
      <img className="p4-conveyor" src={p4Asset("传送带")} alt="" />
      <div className="p4-patterns">
        <img src={p4Asset("传送带花纹（一组）")} alt="" />
        <img src={p4Asset("传送带花纹（一组）")} alt="" />
      </div>
    </div>
  );
}

function PieceImage({ className = "", kind }: { className?: string; kind: PieceKind }) {
  const pieceAssetByKind: Record<PieceKind, string> = {
    nose: "火箭头",
    "left-fin": "左尾板",
    "right-fin": "右尾板",
    base: "底座",
    "gear-red": "红色齿轮",
    "gear-yellow": "黄色齿轮",
    "gear-blue": "蓝色齿轮",
    "gear-cream": "米色齿轮",
  };

  return <img className={`piece-img piece-${kind} ${className}`} src={p4Asset(pieceAssetByKind[kind])} alt="" />;
}

function p4Asset(name: string) {
  return `/assets/p4/${name}.svg`;
}

function p5Asset(name: string) {
  return `/assets/p5/${name}.svg`;
}

function p6Asset(name: string) {
  return `/assets/p6/${name}.svg`;
}

function p7Asset(name: string) {
  return `/assets/p7/${name}.svg`;
}

function makeMockAiSummary(sourceText: string) {
  const trimmed = sourceText.replace(/\s+/g, "").slice(0, 8);
  const subject = trimmed || "这件事";
  const summary = `${AI_ANXIETY_PREFIX}${subject}，${AI_HOPE_PREFIX}自己准备得更稳。`;

  return summary.slice(0, AI_RESTATEMENT_MAX_CHARS);
}

function splitAiSummaryForDisplay(summary: string) {
  let body = summary.trim();
  const anxietyIndex = body.indexOf(AI_ANXIETY_PREFIX);

  if (anxietyIndex >= 0) {
    body = body.slice(anxietyIndex + AI_ANXIETY_PREFIX.length);
  }

  const hopeIndex = body.indexOf(AI_HOPE_PREFIX);

  if (hopeIndex >= 0) {
    return {
      anxiety: trimDisplaySegment(body.slice(0, hopeIndex)),
      hope: trimDisplaySegment(body.slice(hopeIndex + AI_HOPE_PREFIX.length)),
    };
  }

  const punctuationIndex = body.search(/[，,。]/);

  if (punctuationIndex >= 0) {
    return {
      anxiety: trimDisplaySegment(body.slice(0, punctuationIndex)),
      hope: trimDisplaySegment(body.slice(punctuationIndex + 1)),
    };
  }

  return {
    anxiety: trimDisplaySegment(body.slice(0, 12)),
    hope: trimDisplaySegment(body.slice(12)),
  };
}

function trimDisplaySegment(segment: string) {
  return segment.replace(/^[\s，,。]+|[\s，,。]+$/g, "");
}

function buildPaperLines(text: string) {
  const normalizedText = text.replace(/\r/g, "");

  if (!normalizedText) {
    return [""];
  }

  let remainingText = normalizedText;
  const linesFromBottom: string[] = [];

  for (const slot of PAPER_LINE_SLOTS) {
    if (!remainingText) {
      break;
    }

    const nextLine = takeLastMeasuredLine(
      remainingText,
      slot.width,
      slot.fontSize,
    );

    linesFromBottom.push(nextLine.line);
    remainingText = nextLine.rest;
  }

  return linesFromBottom.reverse();
}

function takeLastMeasuredLine(text: string, maxWidth: number, fontSize: number) {
  if (text.endsWith("\n")) {
    return {
      line: "",
      rest: text.slice(0, -1),
    };
  }

  const paragraphStart = text.lastIndexOf("\n") + 1;
  const paragraph = text.slice(paragraphStart);
  const prefix = text.slice(0, paragraphStart);
  let startIndex = paragraph.length;

  for (let index = paragraph.length - 1; index >= 0; index -= 1) {
    const candidate = paragraph.slice(index);

    if (measurePaperText(candidate, fontSize) <= maxWidth) {
      startIndex = index;
      continue;
    }

    break;
  }

  if (startIndex === paragraph.length) {
    startIndex = Math.max(0, paragraph.length - 1);
  }

  return {
    line: paragraph.slice(startIndex),
    rest: `${prefix}${paragraph.slice(0, startIndex)}`,
  };
}

function measurePaperText(text: string, fontSize: number) {
  if (typeof document === "undefined") {
    return estimatePaperTextWidth(text, fontSize);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return estimatePaperTextWidth(text, fontSize);
  }

  context.font = `${fontSize}px "Fusion Pixel", "Courier New", monospace`;
  return context.measureText(text).width;
}

function estimatePaperTextWidth(text: string, fontSize: number) {
  return Array.from(text).reduce((total, char) => {
    if (/[\u4e00-\u9fff]/.test(char)) {
      return total + fontSize;
    }

    if (/[A-Za-z0-9]/.test(char)) {
      return total + fontSize * 0.62;
    }

    return total + fontSize * 0.5;
  }, 0);
}
