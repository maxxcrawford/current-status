(function () {
  'use strict';

  const feed = document.querySelector('[data-feed]');
  const likesPath = '/api/post-likes';
  const reactions = new Map();
  const pendingLikes = new Set();
  const shareTimers = new WeakMap();
  const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact' });
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

  function getReaction(id) {
    try {
      return JSON.parse(localStorage.getItem(`post-like:${id}`)) || reactions.get(id);
    } catch {
      return reactions.get(id);
    }
  }

  function rememberReaction(id, reaction) {
    reactions.set(id, reaction);
    try {
      localStorage.setItem(`post-like:${id}`, JSON.stringify(reaction));
    } catch { /* The like still works when browser storage is unavailable. */ }
  }

  function updateLike(button, liked, count) {
    const counter = button.querySelector('[data-post-like-count]');
    const displayed = Number(counter.dataset.count);
    if (Number.isSafeInteger(count) && (!Number.isFinite(displayed) || count >= displayed)) {
      counter.dataset.count = count;
    }
    button.toggleAttribute('data-liked', liked);
    if (liked || pendingLikes.has(button)) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    const total = Number(counter.dataset.count);
    counter.textContent = total > 0 ? compactCount.format(total) : '';
    const label = liked ? 'Liked post' : 'Like post';
    button.setAttribute('aria-label', Number.isFinite(total)
      ? `${label} (${total.toLocaleString()} ${total === 1 ? 'like' : 'likes'})` : label);
  }

  async function loadLikeCounts(actions) {
    const query = new URLSearchParams();
    for (const row of actions) query.append('id', row.dataset.postActions);
    try {
      const response = await fetch(`${likesPath}?${query}`);
      if (!response.ok) return;
      const counts = await response.json();
      for (const row of actions) {
        const id = row.dataset.postActions;
        updateLike(row.querySelector('[data-post-like]'), !!getReaction(id)?.liked, counts[id]);
      }
    } catch { /* A failed count lookup leaves the post and its actions usable. */ }
  }

  function initializePostActions(root) {
    const actions = [...root.querySelectorAll('[data-post-actions]')];
    for (const row of actions) {
      row.querySelector('[data-post-like-status]').textContent = '';
      row.querySelector('[data-post-share-status]').textContent = '';
      updateLike(row.querySelector('[data-post-like]'), !!getReaction(row.dataset.postActions)?.liked);
      row.hidden = false;
    }
    for (let start = 0; start < actions.length; start += 30) {
      loadLikeCounts(actions.slice(start, start + 30));
    }
  }

  async function likePost(row, button, status) {
    const id = row.dataset.postActions;
    let reaction = getReaction(id);
    if (reaction?.liked || pendingLikes.has(button)) return;

    pendingLikes.add(button);
    button.setAttribute('aria-disabled', 'true');
    status.textContent = '';
    let count;
    try {
      reaction ??= { id: crypto.randomUUID(), liked: false };
      rememberReaction(id, reaction);
      const response = await fetch(`${likesPath}?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'x-reaction-id': reaction.id },
      });
      if (response.status === 429) {
        status.textContent = 'Too many requests. Try again in a minute.';
        return;
      }
      if (!response.ok) throw new Error('Like failed');
      ({ count } = await response.json());
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid like count');
      rememberReaction(id, { ...reaction, liked: true });
      status.textContent = 'Liked.';
    } catch {
      status.textContent = 'Could not save the like. Try again.';
    } finally {
      pendingLikes.delete(button);
      updateLike(button, !!getReaction(id)?.liked, count);
    }
  }

  function initializePosts(root) {
    root.querySelectorAll('.user-profile-full-name').forEach(el => { el.textContent = 'Maxx Crawford'; });
    root.querySelectorAll('.user-profile-username').forEach(el => { el.textContent = '@woodenwarship'; });
    root.querySelectorAll('.post-content-container-image').forEach(image => {
      image.style.backgroundColor = image.dataset.color;
      if (imageObserver) imageObserver.observe(image);
      else loadImage(image);
    });
    initializePostActions(root);
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

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-post-like], [data-post-share]');
    if (!button) return;
    const row = button.closest('[data-post-actions]');
    if (button.matches('[data-post-like]')) {
      await likePost(row, button, row.querySelector('[data-post-like-status]'));
      return;
    }

    const status = row.querySelector('[data-post-share-status]');
    const link = row.closest('.post').querySelector('a.post-date').href;
    try {
      await navigator.clipboard.writeText(link);
      clearTimeout(shareTimers.get(status));
      status.textContent = 'Link copied.';
      shareTimers.set(status, setTimeout(() => {
        status.textContent = '';
        shareTimers.delete(status);
      }, 2000));
    } catch {
      clearTimeout(shareTimers.get(status));
      status.textContent = '';
      window.prompt('Copy this post link', link);
    }
  });

  window.addEventListener('pageshow', event => {
    if (event.persisted) initializePostActions(document);
  });

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
