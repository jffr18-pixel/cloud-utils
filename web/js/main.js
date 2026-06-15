/* =============================================================
   Burocracia Zero — JS principal (vanilla, sin dependencias)
   Mantener ligero para no penalizar el rendimiento / Core Web Vitals.
   ============================================================= */
(function () {
  "use strict";

  /* ---- Menú de navegación móvil ---- */
  var toggle = document.querySelector(".nav__toggle");
  var menu = document.querySelector(".nav__menu");

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Cerrar al pulsar un enlace
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---- Contador animado de estadísticas ---- */
  var counters = document.querySelectorAll("[data-count]");
  if (counters.length && "IntersectionObserver" in window) {
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          animateCount(entry.target);
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach(function (c) {
      obs.observe(c);
    });
  }

  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1400;
    var start = null;

    function frame(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      el.textContent = Math.floor(eased * target).toLocaleString("es-ES") + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---- Año dinámico en el footer ---- */
  var year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  /* ---- Validación + envío simulado del formulario de contacto ---- */
  var form = document.querySelector("[data-contact-form]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector("[data-form-status]");

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // NOTA: conectar a un backend o servicio (Formspree, Web3Forms,
      // Wix Forms, etc.) cambiando el atributo action del formulario.
      if (status) {
        status.textContent =
          "¡Gracias! Hemos recibido tu solicitud. Te responderemos en menos de 24 h laborables.";
        status.style.color = "#0e7a63";
      }
      form.reset();
    });
  }
})();
