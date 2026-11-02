// Blocking, before the stylesheet: resolve appearance before the first paint.
(function () {
  var choice;
  try { choice = localStorage.getItem("formradar-theme"); } catch (_) {}
  var theme = choice === "light" || choice === "dark" ? choice
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#11182C" : "#FFFFFF";
  ["favicon", "fallback-icon", "touch-icon", "app-manifest"].forEach(function (id) {
    var element = document.getElementById(id);
    if (element) element.href = "/brand/" + theme + "/" + element.dataset.file;
  });
})();
