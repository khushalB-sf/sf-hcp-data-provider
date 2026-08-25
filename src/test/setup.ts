// jsdom doesn't implement these, and react-window / the grid both use them.
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
