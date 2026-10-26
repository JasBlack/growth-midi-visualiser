/* Appended inside the original module: no extra dependency or server needed. */
const growthSearch = document.getElementById('controlSearch');
const growthSearchHelp = document.getElementById('searchHelp');
const growthOpenBeforeSearch = new Map();
function growthFilterControls() {
  const query = growthSearch.value.trim().toLowerCase();
  const sections = [...document.querySelectorAll('#panel details.sec')];
  let matches = 0;
  for (const section of sections) {
    if (query && !growthOpenBeforeSearch.has(section)) growthOpenBeforeSearch.set(section, section.open);
    const match = !query || section.textContent.toLowerCase().includes(query);
    section.hidden = !match;
    if (query && match) { section.open = true; matches++; }
    if (!query && growthOpenBeforeSearch.has(section)) section.open = growthOpenBeforeSearch.get(section);
  }
  if (!query) growthOpenBeforeSearch.clear();
  growthSearchHelp.textContent = query
    ? (matches ? `${matches} matching sections · clear to show all` : 'No matching settings. Try “species”, “camera” or “decay”.')
    : 'Hold A–K to grow · F2 hides controls · Esc brings them back';
}
growthSearch.addEventListener('input', growthFilterControls);
growthSearch.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    growthSearch.value = '';
    growthFilterControls();
    growthSearch.blur();
    event.stopPropagation();
  }
});
new MutationObserver(() => { if (growthSearch.value) growthFilterControls(); })
  .observe(document.getElementById('engineControls'), {childList: true});
document.getElementById('returnUi').addEventListener('click', () => pd(false));
document.body.classList.toggle('capture-output', new URLSearchParams(location.search).get('ui') === '0');
growthFilterControls();
