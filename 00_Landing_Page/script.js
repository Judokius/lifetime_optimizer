const intro = document.querySelector("#intro");
const menu = document.querySelector("#menu");
const skipButton = document.querySelector("#skip-intro");
let menuShown = false;

function showMenu() {
  if (menuShown) return;
  menuShown = true;
  intro.hidden = true;
  menu.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

skipButton.addEventListener("click", showMenu);
window.setTimeout(showMenu, 5200);
