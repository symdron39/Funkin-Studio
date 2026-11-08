/*
 * Contributors: Add a new object to the array to publish a new credit.
 * image: optional image URL or local file path relative to the repository root.
 * links: optional [{label: "GitHub", url: "https://github.com/..."}]
 * Avoid publishing private information without permission.
 */
export const CONTRIBUTORS = [
  {
    name: "Reo",
    role: { ja: "メイン開発者", en: "Main Developer" },
    image: "./funkin-studio/images/Reo-icon.png",
    description: {
      ja: "こんにちは！もしよければ、このツールの評価やバグ報告をGitHubに投稿していただけると嬉しいです！",
      en: "Hi! If you have a moment, please leave feedback or report any bugs on GitHub!"
    },
    links: [
      { label: "GitHub", url: "https://github.com/symdron39" },
      { label: "Youtube (JP)", url: "https://youtube.com/@RE0GAMES-Funkin"},
      { label: "Youtube (EN)", url: "https://youtube.com/@symdron39" }
    ]
  },
  {
    name: "ChatGPT (OpenAI)",
    role: { ja: "AI開発アシスタント", en: "AI Development Assistant" },
    image: "./funkin-studio/images/chatgpt-assistant.svg",
    description: {
      ja: "コードレビュー、デバッグ、UI設計、開発に関する相談を支援しました。AIによる協力であり、人間の開発メンバーではありません。",
      en: "Assisted with code review, debugging, UI design, and development guidance. AI assistance; not a human contributor."
    },
    links: [
      { label: "ChatGPT", url: "https://chatgpt.com/" }
    ]
  },
  {
    name: "Claude (Anthropic)",
    role: { ja: "AI開発アシスタント", en: "AI Development Assistant" },
    image: "./funkin-studio/images/claude-assistant.svg",
    description: {
      ja: "バグ修正とコードの見直しをお手伝いしました。Reoさんの「Funkin' Studio」、これからも応援しています！（AIによる協力であり、人間の開発メンバーではありません）",
      en: "Helped with bug fixes and code review. Rooting for Reo and Funkin' Studio! (AI assistance; not a human contributor.)"
    },
    links: [
      { label: "Claude", url: "https://claude.ai/" },
      { label: "Anthropic", url: "https://www.anthropic.com/" }
    ]
  }
];
