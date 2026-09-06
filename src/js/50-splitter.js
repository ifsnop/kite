/* ================= Separador redimensionable y toggle ================= */

const splitter = document.getElementById("splitter");
const navToggle = document.getElementById("nav-toggle");

function setNavWidth(px) {
  px = Math.min(600, Math.max(200, px));
  document.documentElement.style.setProperty("--nav-width", px + "px");
}
splitter.addEventListener("mousedown", e => {
  e.preventDefault();
  document.body.classList.add("resizing");
  const onMove = ev => { setNavWidth(ev.clientX); map.invalidateSize(); };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("resizing");
    map.invalidateSize();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

navToggle.addEventListener("click", () => {
  const hidden = document.body.classList.toggle("nav-hidden");
  navToggle.innerHTML = hidden ? "&#9654;" : "&#9664;";
  map.invalidateSize();
});

