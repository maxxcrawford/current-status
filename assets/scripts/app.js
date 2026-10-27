(function () {
  'use strict';

  const feed = document.querySelector('[data-feed]');
  const imageObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadImage(entry.target);
          imageObserver.unobserve(entry.target);
        }
      }
    }) : null;

  function loadImage(image) {
    image.classList.remove('loading');
    image.style.backgroundImage = `url('${image.dataset.img}')`;
  }

  function initializePosts(root) {
    root.querySelectorAll('.user-profile-full-name').forEach(el => { el.textContent = 'Maxx Crawford'; });
    root.querySelectorAll('.user-profile-username').forEach(el => { el.textContent = '@woodenwarship'; });
    root.querySelectorAll('.post-content-container-image').forEach(image => {
      image.style.backgroundColor = image.dataset.color;
      if (imageObserver) imageObserver.observe(image);
      else loadImage(image);
    });
  }

  // Save each history entry separately, so returning to a post's feed restores its batch and position.
  let snapshotKey;
  let restoredScroll;
  if (feed) {
    try {
      snapshotKey = history.state?.feedSnapshot || `feed:${Date.now()}:${Math.random()}`;
      history.replaceState({ ...history.state, feedSnapshot: snapshotKey }, '');
      const snapshot = JSON.parse(sessionStorage.getItem(snapshotKey) || 'null');
      if (snapshot?.version === feed.dataset.feedVersion) {
        feed.innerHTML = snapshot.html;
        restoredScroll = snapshot.scrollY;
      }
    } catch { /* Browsing still works when storage is unavailable. */ }
  }

  initializePosts(document);

  document.addEventListener('click', event => {
    const post = event.target.closest('.post[data-permalink]');
    if (!post || event.target.closest('a, button, .post-content-container-image') ||
        event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        window.getSelection().toString()) return;
    window.location.assign(post.dataset.permalink);
  });

  if (!feed) return;

  let loading = false;
  const paginationObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNextPage();
    }, { rootMargin: '400px' }) : null;

  function watchNextPage() {
    paginationObserver?.disconnect();
    const next = feed.querySelector('[data-feed-next]');
    if (next) paginationObserver?.observe(next);
  }

  async function loadNextPage() {
    const next = feed.querySelector('[data-feed-next]');
    if (loading || !next) return;
    loading = true;
    paginationObserver?.disconnect();
    const pagination = next.closest('[data-feed-pagination]');
    const status = pagination.querySelector('[data-feed-status]');
    pagination.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading more posts…';
    try {
      const response = await fetch(next.href);
      if (!response.ok) throw new Error('Page request failed');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const incoming = page.querySelector('[data-feed]');
      if (!incoming || incoming.dataset.feedVersion !== feed.dataset.feedVersion ||
          !incoming.querySelector('.post[data-permalink]')) throw new Error('Feed changed or page is invalid');
      const count = incoming.querySelectorAll('.post[data-permalink]').length;
      // Validate the full batch before changing the current feed, so a failed request can be retried.
      const fragment = document.createDocumentFragment();
      const existing = new Set([...feed.querySelectorAll('.post[data-permalink]')].map(post => post.dataset.permalink));
      for (const child of [...incoming.children]) {
        if (!child.matches('.post[data-permalink]') || !existing.has(child.dataset.permalink)) {
          fragment.append(document.importNode(child, true));
        }
      }
      initializePosts(fragment);
      pagination.replaceWith(fragment);
      const announcement = document.querySelector('[data-feed-announcement]');
      if (announcement) announcement.textContent = `${count} more posts loaded.`;
      loading = false;
      watchNextPage();
    } catch {
      pagination.removeAttribute('aria-busy');
      status.textContent = 'Could not load more posts. Select Retry to try again.';
      next.textContent = 'Retry loading posts';
      loading = false;
      // Retry only on an explicit click, rather than repeatedly fetching while in view.
    }
  }

  feed.addEventListener('click', event => {
    if (!event.target.closest('[data-feed-next]') || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    loadNextPage();
  });

  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(snapshotKey, JSON.stringify({
        version: feed.dataset.feedVersion, html: feed.innerHTML, scrollY: window.scrollY,
      }));
    } catch { /* Storage limits must not interrupt navigation. */ }
  });

  const pagination = feed.querySelector('[data-feed-pagination]');
  pagination?.removeAttribute('aria-busy');
  const status = feed.querySelector('[data-feed-status]');
  if (status) status.textContent = '';
  if (restoredScroll !== undefined) requestAnimationFrame(() => window.scrollTo(0, restoredScroll));
  watchNextPage();
})();
