import { app } from "../../scripts/app.js";

const JA = {
  "Timeline": "タイムライン",
  "Lyrics": "歌詞",
  "Generation": "生成設定",
  "Undo": "元に戻す",
  "Redo": "やり直す",
  "Reset": "リセット",
  "Cancel": "キャンセル",
  "Save to Node": "ノードに保存",
  "Close": "閉じる",
  "Maximize": "最大化",
  "Restore": "元に戻す",
  "Song Timeline": "ソングタイムライン",
  "Song Settings": "曲全体の設定",
  "Main Vocal": "メインボーカル",
  "More Settings": "詳細設定",
  "Genre": "ジャンル",
  "BPM": "BPM",
  "Key": "キー",
  "Scale / Mode": "スケール / モード",
  "Effective Key": "実効キー",
  "Meter": "拍子",
  "Vocal": "ボーカル",
  "Instrumental": "インストゥルメンタル",
  "Working title": "作業タイトル",
  "Subgenres / influences": "サブジャンル / 影響",
  "Mood / direction": "ムード / 方向性",
  "Production profile": "プロダクション設定",
  "Lead / voice type": "リード / 声タイプ",
  "Timbre / character": "声質 / キャラクター",
  "Delivery": "歌唱表現",
  "Harmony / backing": "ハーモニー / バックボーカル",
  "Vocal effects": "ボーカルエフェクト表現",
  "Structure": "構成",
  "Energy": "エナジー",
  "Vocal Style": "ボーカルスタイル",
  "Instruments": "楽器",
  "Time": "時間",
  "Scale": "スケール",
  "Fit": "全体表示",
  "Section Inspector": "セクションインスペクター",
  "Type": "タイプ",
  "Title": "タイトル",
  "Duration (s)": "長さ（秒）",
  "Vocal style": "ボーカルスタイル",
  "Arrangement": "アレンジ",
  "Duplicate": "複製",
  "Delete": "削除",
  "Lyrics & Caption": "歌詞とキャプション",
  "Caption": "キャプション",
  "Caption — Draft Editing": "キャプション — ドラフト編集中",
  "Full Lyrics": "全歌詞",
  "Section Lyrics": "セクション歌詞",
  "Per section": "セクションごと",
  "Import Prompt": "プロンプトをインポート",
  "Copy": "コピー",
  "Copied": "コピー済み",
  "Edit": "編集",
  "Analyze & Import": "解析してインポート",
  "Apply to Sections": "セクションへ適用",
  "No lyrics": "歌詞なし",
  "Generation Settings": "生成設定",
  "MiniMax Music3 AR Generation": "MiniMax Music3 AR生成",
  "Music Seed (AR)": "音楽シード（AR）",
  "Duration Limit": "生成時間上限",
  "Music CFG (AR)": "音楽CFG（AR）",
  "Music Top-K": "音楽Top-K",
  "Timeline Total": "タイムライン合計",
  "Auto Sync with Timeline": "タイムラインと自動同期",
  "Open Semantic Studio": "セマンティックスタジオを開く",
  "Music3 Semantic Studio Audio Editor": "Music3 セマンティックスタジオ オーディオエディター",
  "Preview": "プレビュー",
  "Draft · Current Edits": "ドラフト · 現在の編集",
  "Rendered A · Last Queue": "レンダーA · 前回のQueue",
  "Zoom": "ズーム",
  "Waveform": "波形表示",
  "Auto L/R": "自動 L/R",
  "Stereo Split": "ステレオ分割",
  "Stereo Overlay": "ステレオ重ね表示",
  "Mono Mix Preview": "モノミックス確認",
  "Select · F1": "選択 · F1",
  "Envelope · F2": "エンベロープ · F2",
  "Main Track Waveform": "メイントラック波形",
  "Main Track": "メイントラック",
  "Stereo": "ステレオ",
  "Mono": "モノラル",
  "Track Gain": "トラックゲイン",
  "Track Pan": "トラックパン",
  "Preview Peak": "プレビューピーク",
  "Cut": "カット",
  "Paste": "貼り付け",
  "Split": "分割",
  "Silence": "無音化",
  "Reverse": "反転",
  "Mute Clip": "クリップをミュート",
  "Crossfade Next": "次とクロスフェード",
  "Use Preview Take": "プレビューテイクを使用",
  "No selection": "選択なし",
  "Selection": "選択範囲",
  "Start (s)": "開始（秒）",
  "End (s)": "終了（秒）",
  "Length": "長さ",
  "Track": "トラック",
  "Clip": "クリップ",
  "Envelope": "エンベロープ",
  "Master": "マスター",
  "Takes": "テイク",
  "Position": "現在位置",
  "Start": "開始",
  "End": "終了",
  "Tempo": "テンポ",
  "Snap": "スナップ",
  "Off": "オフ",
  "Save Edits": "編集を保存",
  "Bypass": "バイパス",
  "Import Music3 Prompt": "Music3プロンプトをインポート",
  "Caption / Structured Caption": "キャプション / 構造化キャプション",
  "Import mode": "インポート方式",
  "Replace section structure": "セクション構成を置換",
  "Merge detected fields": "検出項目をマージ",
  "Analyze": "解析",
  "Clear": "クリア",
  "Import Preview": "インポートプレビュー",
  "Apply Import": "インポートを適用",
  "Detected Global / Vocal": "検出した全体設定 / ボーカル",
  "Detected Sections": "検出したセクション",
  "Section": "セクション",
  "Duration": "長さ",
  "Warnings": "警告",
  "No analysis yet.": "まだ解析されていません。",
  "Analyze before applying.": "適用前に解析してください。",
};

const PLACEHOLDERS_JA = {
  "Genre / style…": "ジャンル / スタイル…",
  "Key…": "キー…",
  "Scale / mode…": "スケール / モード…",
  "Optional project title": "任意のプロジェクトタイトル",
  "Add influence / subgenre…": "影響 / サブジャンルを追加…",
  "Add mood / direction…": "ムード / 方向性を追加…",
  "Production, room, texture, mix character…": "プロダクション、空間、質感、ミックスの特徴…",
  "Section lyrics": "このセクションの歌詞",
  "Arrangement directive": "アレンジ指示",
  "Add instrument / texture…": "楽器 / 質感を追加…",
};

export function currentUiLocale() {
  let locale = "";
  try {
    locale = String(app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || "");
  } catch {}
  if (!locale) {
    try { locale = String(document.documentElement?.lang || ""); } catch {}
  }
  if (!locale) locale = String(navigator.language || navigator.languages?.[0] || "en");
  return /^ja(?:-|$)/i.test(locale) ? "ja" : "en";
}

export function tr(text) {
  const value = String(text ?? "");
  return currentUiLocale() === "ja" ? (JA[value] || value) : value;
}

function translateTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const raw = node.nodeValue || "";
  const trimmed = raw.trim();
  if (!trimmed || !(trimmed in JA)) return;
  node.nodeValue = raw.replace(trimmed, JA[trimmed]);
}

function translateElement(element) {
  if (!(element instanceof Element)) return;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.placeholder && PLACEHOLDERS_JA[element.placeholder]) element.placeholder = PLACEHOLDERS_JA[element.placeholder];
  }
  for (const attr of ["title", "aria-label"]) {
    const value = element.getAttribute(attr);
    if (value && JA[value]) element.setAttribute(attr, JA[value]);
  }
  if (element instanceof HTMLOptionElement && JA[element.textContent || ""]) element.textContent = JA[element.textContent || ""];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) translateTextNode(child);
  }
}

export function localizeTree(root) {
  if (currentUiLocale() !== "ja" || !root) return;
  if (root instanceof Element) translateElement(root);
  for (const element of root.querySelectorAll?.("*") || []) translateElement(element);
}

export function installUiLocalization(root) {
  localizeTree(root);
  if (currentUiLocale() !== "ja" || !globalThis.MutationObserver || !root) return () => {};
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else if (node instanceof Element) localizeTree(node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
