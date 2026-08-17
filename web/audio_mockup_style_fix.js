const STYLE_ID = "m3ss-v2-mockup-style-fix";

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .m3ssv2-command-group.is-tools {
      border-color: rgba(46, 127, 214, .58);
      box-shadow: inset 0 0 0 1px rgba(46, 127, 214, .12);
    }
    .is-edit .m3ssv2-command-button {
      border-color: rgba(139, 109, 211, .26) !important;
    }
    .m3ssv2-mockup-ui .m3ssv2-wave-selection {
      top: 76px;
    }
  `;
  document.head.appendChild(style);
}
