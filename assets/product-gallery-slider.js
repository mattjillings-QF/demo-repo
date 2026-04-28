class ProductGallerySliderController {
  constructor(root = document) {
    this.root = root;
    this.instances = new WeakMap();
    this.init(root);
  }

  init(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(scope.querySelectorAll("[gallery-container]"));
    containers.forEach((container) => this.initContainer(container));
  }

  initContainer(container) {
    if (!container || this.instances.has(container)) return;

    const main = container.querySelector("[main-gallery-slider]");
    const thumbs = container.querySelector("[data-thumb-gallery-slider], [thumb-gallery-slider]");

    if (!main || !thumbs) {
      this.markReady(container);
      return;
    }

    // Never keep the gallery hidden while waiting for slider instances.
    this.markReady(container);

    const thumbTrackContainer = thumbs.querySelector(".blaze-track-container");
    const thumbSlides = Array.from(thumbs.querySelectorAll(".thumb"));
    const onThumbClick = (event) => {
      const recentDragAt = Number(thumbTrackContainer?.dataset?.thumbDraggedAt || 0);
      if (recentDragAt && Date.now() - recentDragAt < 250) return;

      const target = event.currentTarget;
      const index = Number(target?.dataset?.index ?? thumbSlides.indexOf(target));
      if (!Number.isFinite(index)) return;
      const mainSlider = main.slider;
      if (mainSlider && typeof mainSlider.slideTo === "function") {
        mainSlider.slideTo(index, 0);
      }
    };

    const onThumbKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThumbClick(event);
    };

    thumbSlides.forEach((slide, index) => {
      if (!slide.dataset.index) {
        slide.dataset.index = String(index);
      }
      if (!slide.hasAttribute("tabindex")) {
        slide.setAttribute("tabindex", "0");
      }
      if (!slide.hasAttribute("role")) {
        slide.setAttribute("role", "button");
      }
      slide.addEventListener("click", onThumbClick);
      slide.addEventListener("keydown", onThumbKeydown);
    });

    const setActiveThumb = (nextIndex = 0) => {
      const activeIndex = Number(nextIndex) || 0;
      thumbSlides.forEach((slide, index) => {
        const isActive = index === activeIndex;
        slide.classList.toggle("blaze-thumb-active", isActive);
        slide.setAttribute("aria-current", isActive ? "true" : "false");
      });

      this.ensureActiveThumbInView(container, thumbs, activeIndex, thumbSlides.length);
    };

    const onResize = () => {
      this.syncThumbHeight(container, main, thumbs);
      setActiveThumb(main.slider?.activeIndex ?? 0);
    };
    window.addEventListener("resize", onResize, { passive: true });

    const teardownVerticalThumbDrag = this.enableVerticalThumbDrag(container, thumbs);

    const bindMainEvents = () => {
      const slider = main.slider;
      if (!slider) return;

      const thumbsSlider = thumbs.slider;

      const onMainSliderChange = ({ activeIndex }) => {
        setActiveThumb(activeIndex ?? 0);
      };

      if (typeof slider.on === "function") {
        slider.on("slideChange", onMainSliderChange);
        slider.on("activeIndexChange", onMainSliderChange);
      }

      const onMainDomSlideChange = (event) => {
        setActiveThumb(event?.detail?.activeIndex ?? 0);
      };

      main.addEventListener("slidechange", onMainDomSlideChange);
      main.addEventListener("activeindexchange", onMainDomSlideChange);

      setActiveThumb(slider.activeIndex ?? 0);
      thumbsSlider?.refresh?.();
      this.syncThumbHeight(container, main, thumbs);
      this.markReady(container);

      this.instances.set(container, {
        main,
        thumbs,
        thumbSlides,
        teardownVerticalThumbDrag,
        onThumbClick,
        onThumbKeydown,
        onResize,
        slider,
        onMainSliderChange,
        onMainDomSlideChange,
      });
    };

    if (main.slider) {
      bindMainEvents();
    } else {
      let bindAttempts = 0;
      const maxBindAttempts = 180;
      const attemptBind = () => {
        if (main.slider) {
          bindMainEvents();
          return;
        }
        bindAttempts += 1;
        window.themeBlazeSliderController?.refresh?.(main);
        if (bindAttempts >= maxBindAttempts) {
          this.markReady(container);
          return;
        }
        requestAnimationFrame(attemptBind);
      };
      attemptBind();
    }
  }

  getEffectiveThumbOrientation(container) {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (!isDesktop) return "horizontal";

    const configuredOrientation = container?.getAttribute("data-thumb-orientation") || "vertical";
    return configuredOrientation === "horizontal" ? "horizontal" : "vertical";
  }

  ensureActiveThumbInView(container, thumbs, activeIndex, totalThumbs) {
    if (!thumbs) return;
    const safeTotal = Number(totalThumbs);
    if (!Number.isFinite(safeTotal) || safeTotal < 2) return;

    const clampedIndex = Math.max(0, Math.min(safeTotal - 1, Number(activeIndex) || 0));
    const effectiveOrientation = this.getEffectiveThumbOrientation(container);

    if (
      effectiveOrientation === "horizontal" &&
      thumbs.slider &&
      typeof thumbs.slider.slideTo === "function"
    ) {
      thumbs.slider.slideTo(clampedIndex, 0);
      return;
    }

    const activeThumb = thumbs.querySelector(`.thumb[data-index="${clampedIndex}"]`);
    activeThumb?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }

  syncThumbHeight(container, main, thumbs) {
    if (!container || !main || !thumbs) return;
    const thumbOrientation = this.getEffectiveThumbOrientation(container);

    if (thumbOrientation === "horizontal") {
      const thumbWrap = thumbs.closest(".thumb-gallery");
      if (thumbWrap) {
        thumbWrap.style.height = "";
        thumbWrap.style.maxHeight = "";
        thumbWrap.style.minHeight = "";
        thumbWrap.style.overflow = "";
      }

      thumbs.style.height = "";
      thumbs.style.maxHeight = "";
      return;
    }

    const mainHeight = main.getBoundingClientRect().height;
    if (mainHeight > 0) {
      const thumbWrap = thumbs.closest(".thumb-gallery");
      if (thumbWrap) {
        thumbWrap.style.height = `${mainHeight}px`;
        thumbWrap.style.maxHeight = `${mainHeight}px`;
        thumbWrap.style.minHeight = `${mainHeight}px`;
        thumbWrap.style.overflow = "hidden";
      }
      thumbs.style.height = "100%";
      thumbs.style.maxHeight = "100%";
    }
  }

  enableVerticalThumbDrag(container, thumbs) {
    const trackContainer = thumbs?.querySelector?.(".blaze-track-container");
    if (!trackContainer) return null;

    let isPointerDown = false;
    let pointerId = null;
    let startY = 0;
    let startScrollTop = 0;
    let hasDragged = false;

    const onPointerMove = (event) => {
      if (!isPointerDown || pointerId !== event.pointerId) return;

      const deltaY = event.clientY - startY;
      if (Math.abs(deltaY) > 6) {
        if (!hasDragged) {
          hasDragged = true;
          trackContainer.classList.add("thumb-dragging");
        }
      }

      if (!hasDragged) return;

      trackContainer.scrollTop = startScrollTop - deltaY;
      event.preventDefault();
    };

    const endPointerDrag = (event) => {
      if (!isPointerDown || pointerId !== event.pointerId) return;

      if (hasDragged) {
        trackContainer.dataset.thumbDraggedAt = String(Date.now());
        trackContainer.classList.remove("thumb-dragging");
      }

      isPointerDown = false;
      pointerId = null;
      hasDragged = false;

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPointerDrag);
      window.removeEventListener("pointercancel", endPointerDrag);
    };

    const onPointerDown = (event) => {
      if (this.getEffectiveThumbOrientation(container) !== "vertical") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      isPointerDown = true;
      pointerId = event.pointerId;
      startY = event.clientY;
      startScrollTop = trackContainer.scrollTop;
      hasDragged = false;

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", endPointerDrag);
      window.addEventListener("pointercancel", endPointerDrag);
    };

    trackContainer.addEventListener("pointerdown", onPointerDown);

    return () => {
      trackContainer.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPointerDrag);
      window.removeEventListener("pointercancel", endPointerDrag);
    };
  }

  markReady(container) {
    container.classList.remove("opacity-0");
    container.classList.add("opacity-1");
  }

  destroy(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const containers = Array.from(scope.querySelectorAll("[gallery-container]"));

    containers.forEach((container) => {
      const instance = this.instances.get(container);
      if (!instance) return;

      instance.thumbSlides.forEach((slide) => {
        slide.removeEventListener("click", instance.onThumbClick);
        slide.removeEventListener("keydown", instance.onThumbKeydown);
      });

      if (instance.slider && typeof instance.slider.off === "function") {
        instance.slider.off("slideChange", instance.onMainSliderChange);
        instance.slider.off("activeIndexChange", instance.onMainSliderChange);
      }

      instance.main.removeEventListener("slidechange", instance.onMainDomSlideChange);
      instance.main.removeEventListener("activeindexchange", instance.onMainDomSlideChange);
      instance.teardownVerticalThumbDrag?.();

      window.removeEventListener("resize", instance.onResize);
      this.instances.delete(container);
    });
  }
}

const controller = new ProductGallerySliderController(document);

if (typeof document !== "undefined") {
  document.addEventListener("shopify:section:load", (event) => {
    controller.init(event?.target || document);
  });

  document.addEventListener("shopify:section:unload", (event) => {
    controller.destroy(event?.target || document);
  });
}
