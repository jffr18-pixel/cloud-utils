// ── Navbar scroll ────────────────────────────────────────────────────────────
const navbar = document.querySelector('.navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  });
}

// ── Mobile menu ──────────────────────────────────────────────────────────────
const menuBtn  = document.querySelector('.nav-menu-btn');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
  menuBtn.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!navbar.contains(e.target)) navLinks.classList.remove('open');
  });
}

// ── Search overlay ───────────────────────────────────────────────────────────
const searchTrigger = document.querySelector('.nav-search-trigger');
const searchOverlay = document.getElementById('searchOverlay');
const searchClose   = document.getElementById('searchClose');
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResultsList');

function openSearch() {
  if (!searchOverlay) return;
  searchOverlay.classList.add('open');
  setTimeout(() => searchInput?.focus(), 100);
}
function closeSearch() {
  searchOverlay?.classList.remove('open');
  if (searchResults) searchResults.innerHTML = '';
  if (searchInput) searchInput.value = '';
}

searchTrigger?.addEventListener('click', openSearch);
searchClose?.addEventListener('click', closeSearch);
searchOverlay?.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

let searchTimer;
searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.innerHTML = ''; return; }
  searchTimer = setTimeout(() => {
    fetch(`/api/buscar?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.length) {
          searchResults.innerHTML = '<p style="padding:.75rem;color:var(--text-muted);font-size:.9rem;">No se encontraron cursos.</p>';
          return;
        }
        searchResults.innerHTML = data.map(c => `
          <a href="/curso/${c.slug}" class="search-result-item" onclick="closeSearch()">
            <span style="font-size:1.2rem">📚</span>
            <div>
              <div style="font-weight:600;font-size:.95rem;color:var(--text-dark)">${c.titulo}</div>
            </div>
          </a>`).join('');
      });
  }, 300);
});

// ── Tabs (detalle curso) ─────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target)?.classList.add('active');
  });
});

// ── Auto-dismiss alerts ──────────────────────────────────────────────────────
document.querySelectorAll('.alert').forEach(alert => {
  setTimeout(() => {
    alert.style.transition = 'opacity .4s';
    alert.style.opacity = '0';
    setTimeout(() => alert.remove(), 400);
  }, 4000);
});

// ── Animate on scroll ────────────────────────────────────────────────────────
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.curso-card, .cat-card, .stat-item').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(16px)';
  el.style.transition = 'opacity .4s ease, transform .4s ease';
  observer.observe(el);
});
document.querySelectorAll('.visible').forEach(el => {
  el.style.opacity = '1';
  el.style.transform = 'none';
});
// Polyfill for older browsers — just make visible after small delay
setTimeout(() => {
  document.querySelectorAll('.curso-card, .cat-card, .stat-item').forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
}, 600);
