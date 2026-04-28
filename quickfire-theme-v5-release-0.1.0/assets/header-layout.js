const ROOT = "[data-header-layout]";
const WRAPPER = ".header-wrapper";
const MEASURE_CLASS = "header-layout--measuring";
const TOLERANCE_PX = 2;
const MOBILE_BREAKPOINT_PX = 992;

/**
 * Toggles `mobile` on the header root when the desktop row cannot fit at natural widths.
 * Uses a one-frame measurement pass with nowrap + no flex-shrink so flex layout does not hide overflow.
 */
export class HeaderLayoutController {
  constructor() {
    this.root = document.querySelector(ROOT);
    this.wrapper = this.root?.querySelector(WRAPPER);
    this.mobileControls = this.root
      ? Array.from(this.root.querySelectorAll(".mobile-control"))
      : [];
    if (!this.root || !this.wrapper) return;

    this._queued = false;
    this._ro = new ResizeObserver(() => this.scheduleUpdate());

    this._ro.observe(this.wrapper);
    window.addEventListener("resize", () => this.scheduleUpdate(), { passive: true });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => this.scheduleUpdate());
    }

    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this.update();
    });
  }

  update() {
    if (!this.root || !this.wrapper) return;

    if (window.innerWidth < MOBILE_BREAKPOINT_PX) {
      this.root.classList.add("mobile");
      this.mobileControls.forEach((control) => {
        control.style.display = "flex";
      });
      return;
    }

    this.root.classList.remove("mobile");
    this.wrapper.classList.add(MEASURE_CLASS);
    void this.wrapper.offsetWidth;

    let overflows = false;
    try {
      overflows =
        this.wrapper.scrollWidth > this.wrapper.clientWidth + TOLERANCE_PX;
    } finally {
      this.wrapper.classList.remove(MEASURE_CLASS);
    }

    const isMobile = overflows;

    this.root.classList.toggle("mobile", isMobile);
    this.mobileControls.forEach((control) => {
      control.style.display = isMobile ? "flex" : "none";
    });
  }
}
