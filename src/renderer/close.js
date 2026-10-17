(function () {
  var b = document.getElementById('close-btn');
  if (!b) return;
  b.addEventListener('click', function () {
    if (window.api && window.api.quit) window.api.quit();
    else window.close();
  });
})();
