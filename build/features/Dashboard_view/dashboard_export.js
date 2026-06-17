function _dashExportPrint() {
  if (typeof _dashCloseDrilldown === "function") {
    _dashCloseDrilldown();
  }
  document.body.classList.add("dash-printing");
  const cleanup = () => {
    document.body.classList.remove("dash-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  requestAnimationFrame(() => {
    try {
      window.print();
    } catch (_) {
      cleanup();
    }
  });
}
