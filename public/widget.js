(function () {
  "use strict";

  if (window.BustedMindsAI && window.BustedMindsAI.__ready) return;

  var script = document.currentScript;
  if (!script || !script.src) return;

  var widgetOrigin = new URL(script.src, window.location.href).origin;
  var position = script.dataset.position === "left" ? "left" : "right";
  var requestedTheme = script.dataset.theme;
  var theme = requestedTheme === "light" || requestedTheme === "dark"
    ? requestedTheme
    : window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  var label = script.dataset.label || "Ask Busted Minds AI";
  var startOpen = script.dataset.open === "true";

  var host = document.createElement("div");
  host.id = "busted-minds-ai-widget";
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = [
    ":host{all:initial;position:fixed;z-index:2147483000;bottom:24px;" + position + ":24px;width:72px;height:72px;color-scheme:" + theme + ";font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
    "*{box-sizing:border-box}",
    ".launcher{position:absolute;inset:0;display:grid;place-items:center;width:72px;height:72px;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:24px;background:linear-gradient(145deg,#19191e,#070709);box-shadow:0 20px 55px rgba(0,0,0,.32),0 0 0 6px rgba(56,215,242,.08);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;overflow:visible}",
    ".launcher:hover{transform:translateY(-3px) rotate(-1deg);box-shadow:0 25px 65px rgba(0,0,0,.4),0 0 0 7px rgba(56,215,242,.12)}",
    ".launcher:focus-visible{outline:3px solid #38d7f2;outline-offset:4px}",
    ".launcher img{display:block;width:58px;height:58px;object-fit:contain;filter:drop-shadow(0 5px 12px rgba(0,0,0,.35))}",
    ".status{position:absolute;right:5px;bottom:5px;width:13px;height:13px;border:3px solid #0b0b0d;border-radius:50%;background:#55dc91;box-shadow:0 0 12px rgba(85,220,145,.8)}",
    ".tip{position:absolute;right:84px;max-width:210px;padding:10px 13px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:#111115;color:#f7f4ee;box-shadow:0 12px 35px rgba(0,0,0,.24);font-size:12px;font-weight:750;line-height:1.2;white-space:nowrap;opacity:0;pointer-events:none;transform:translateX(6px);transition:.18s ease}",
    ".position-left .tip{right:auto;left:84px;transform:translateX(-6px)}",
    ".launcher:hover .tip,.launcher:focus-visible .tip{opacity:1;transform:translateX(0)}",
    ".panel{position:absolute;right:0;bottom:88px;width:min(400px,calc(100vw - 32px));height:min(680px,calc(100vh - 124px));border:1px solid rgba(255,255,255,.12);border-radius:26px;background:#0b0b0d;box-shadow:0 34px 100px rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.08);overflow:hidden;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(16px) scale(.975);transform-origin:bottom right;transition:opacity .2s ease,transform .24s cubic-bezier(.2,.75,.2,1),visibility .2s}",
    ".position-left .panel{right:auto;left:0;transform-origin:bottom left}",
    ".open .panel{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1)}",
    ".open .launcher{opacity:0;visibility:hidden;pointer-events:none;transform:scale(.82)}",
    "iframe{display:block;width:100%;height:100%;border:0;background:#0b0b0d}",
    "@media(max-width:520px){:host{" + position + ":12px;bottom:12px;width:64px;height:64px}.panel,.position-left .panel{position:fixed;inset:8px;width:auto;height:auto;border-radius:22px;transform-origin:bottom center}.launcher{width:64px;height:64px;border-radius:21px}.launcher img{width:52px;height:52px}.tip{display:none}}",
    "@media(prefers-reduced-motion:reduce){.launcher,.panel,.tip{transition:none!important}}"
  ].join("");

  var wrap = document.createElement("div");
  wrap.className = "wrap position-" + position + (startOpen ? " open" : "");

  var launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", label);
  launcher.setAttribute("aria-expanded", startOpen ? "true" : "false");
  launcher.setAttribute("aria-controls", "bmai-widget-panel");

  var logo = document.createElement("img");
  logo.src = widgetOrigin + "/brand/bmai-logo-dark.png";
  logo.alt = "";
  logo.width = 58;
  logo.height = 58;

  var status = document.createElement("span");
  status.className = "status";
  status.setAttribute("aria-hidden", "true");

  var tip = document.createElement("span");
  tip.className = "tip";
  tip.textContent = label;

  var panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "bmai-widget-panel";

  var frame = document.createElement("iframe");
  frame.src = widgetOrigin + "/widget?theme=" + encodeURIComponent(theme);
  frame.title = "Busted Minds AI chat";
  frame.allow = "clipboard-write";
  frame.loading = startOpen ? "eager" : "lazy";

  launcher.appendChild(logo);
  launcher.appendChild(status);
  launcher.appendChild(tip);
  panel.appendChild(frame);
  wrap.appendChild(panel);
  wrap.appendChild(launcher);
  root.appendChild(style);
  root.appendChild(wrap);
  document.body.appendChild(host);

  function setOpen(open) {
    wrap.classList.toggle("open", open);
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) launcher.focus();
  }

  function toggle() {
    setOpen(!wrap.classList.contains("open"));
  }

  function onMessage(event) {
    if (event.origin !== widgetOrigin || event.source !== frame.contentWindow) return;
    if (event.data && event.data.type === "bmai:close") setOpen(false);
  }

  launcher.addEventListener("click", toggle);
  window.addEventListener("message", onMessage);

  window.BustedMindsAI = {
    __ready: true,
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: toggle,
    destroy: function () {
      window.removeEventListener("message", onMessage);
      host.remove();
      delete window.BustedMindsAI;
    }
  };
})();
