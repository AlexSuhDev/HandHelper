/* Default to the public interface. Only a verified server session enables admin UI. */
(function () {
  'use strict';
  document.documentElement.dataset.role = 'user';
})();
