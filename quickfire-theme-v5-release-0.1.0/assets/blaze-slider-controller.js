import BlazeSlider from "@theme/blaze-slider";
import { createBreakpointConfig } from "@theme/slider-config";

const DEFAULT_SLIDER_LOOP = true;

function toNumber(value, fallback) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }
  return Boolean(value);
}

function readConfigFromDataset(element) {
  const dataset = element?.dataset || {};

  const mobileSlides = toNumber(dataset.sliderMobile, 1.25);
  const tabletSlides = toNumber(dataset.sliderTablet, mobileSlides);
  const desktopSlides = toNumber(dataset.sliderDesktop, tabletSlides);
  const wideSlides = toNumber(dataset.sliderWide, desktopSlides);

  const mobileGap = toNumber(dataset.sliderGapMobile, 16);
  const tabletGap = toNumber(dataset.sliderGapTablet, mobileGap);
  const desktopGap = toNumber(dataset.sliderGapDesktop, tabletGap);
  const wideGap = toNumber(dataset.sliderGapWide, desktopGap);

  const loop = toBoolean(dataset.sliderLoop, DEFAULT_SLIDER_LOOP);
  const enablePagination = toBoolean(dataset.sliderPagination, false);
  const enableAutoplay = toBoolean(dataset.sliderAutoplay, false);
  const autoplayInterval = toNumber(dataset.sliderAutoplayInterval, 3000);

  return createBreakpointConfig({
    mobileSlides,
    tabletSlides,
    desktopSlides,
    wideSlides,
    mobileGap,
    tabletGap,
    desktopGap,
    wideGap,
    loop,
    enablePagination,
    enableAutoplay,
    autoplayInterval,
  });
}

function readConfig(element) {
  const configJson = element?.getAttribute("data-blaze-config");
  if (configJson) {
    try {
      const parsed = JSON.parse(configJson);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      console.warn("BlazeSliderController: invalid data-blaze-config JSON", error);
    }
  }

  const legacyConfig = readConfigFromDataset(element);
  return normalizeConfig(legacyConfig);
}

function normalizeBreakpointValue(value) {
  if (!value || typeof value !== "object") return null;

  const slidesToShow = toNumber(value.slidesToShow ?? value.slidesPerView, NaN);
  if (!Number.isFinite(slidesToShow)) return null;

  const rawGap = value.slideGap ?? value.spaceBetween ?? 0;
  const gapNumber = toNumber(rawGap, 0);

  return {
    slidesToShow,
    slideGap: `${gapNumber}px`,
    loop: toBoolean(value.loop, DEFAULT_SLIDER_LOOP),
    enablePagination: toBoolean(value.enablePagination, false),
    enableAutoplay: toBoolean(value.enableAutoplay, false),
    autoplayInterval: toNumber(value.autoplayInterval, 3000),
  };
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") return rawConfig;

  const keys = Object.keys(rawConfig);
  const hasBlazeShape = keys.includes("all") || keys.some((key) => key.includes("min-width"));

  if (hasBlazeShape) {
    const normalized = {};
    keys.forEach((key) => {
      const normalizedValue = normalizeBreakpointValue(rawConfig[key]);
      if (normalizedValue) normalized[key] = normalizedValue;
    });
    return normalized;
  }

  const fallback = normalizeBreakpointValue(rawConfig) || {
    slidesToShow: 1,
    slideGap: "16px",
    loop: DEFAULT_SLIDER_LOOP,
    enablePagination: false,
    enableAutoplay: false,
    autoplayInterval: 3000,
  };

  const normalized = {
    all: fallback,
  };

  const legacyBreakpoints = rawConfig.breakpoints;
  if (legacyBreakpoints && typeof legacyBreakpoints === "object") {
    Object.entries(legacyBreakpoints).forEach(([breakpoint, value]) => {
      const bp = toNumber(breakpoint, NaN);
      if (!Number.isFinite(bp)) return;
      const normalizedValue = normalizeBreakpointValue({
        ...fallback,
        ...(value || {}),
      });
      if (!normalizedValue) return;
      normalized[`(min-width: ${bp}px)`] = normalizedValue;
    });
  }

  return normalized;
}

function getSliderSlideCount(element) {
  if (!element || typeof element.querySelectorAll !== "function") return 0;
  return element.querySelectorAll(".blaze-track > *").length;
}

/**
 * Legacy hook: Blaze + our blaze-slider.esm changes handle slidesPerView vs slide count.
 * Previously loop mode incorrectly rewrote slidesToShow to totalSlides-1 whenever
 * totalSlides > slidesToShow (e.g. 9 slides @ 4/view became 8), which doubled visible density.
 */
function ensureLoopableConfig(rawConfig, totalSlides) {
  if (!rawConfig || typeof rawConfig !== "object") return rawConfig;
  if (!Number.isFinite(totalSlides) || totalSlides <= 1) return rawConfig;
  return rawConfig;
}

function resolveStateIndexForSlide(instance, slideIndex) {
  const states = instance?.states;
  if (!Array.isArray(states) || !states.length) return null;

  let fallbackIndex = 0;

  for (let i = 0; i < states.length; i += 1) {
    const state = states[i];
    const page = state?.page;
    if (!Array.isArray(page) || page.length < 2) continue;

    const [first, last] = page;
    if (slideIndex >= first) {
      fallbackIndex = i;
    }

    if (first <= last) {
      if (slideIndex >= first && slideIndex <= last) return i;
      continue;
    }

    if (slideIndex >= first || slideIndex <= last) return i;
  }

  return fallbackIndex;
}

/**
 * Move the Blaze slider to a page/state index, matching blaze-slider pagination behavior
 * (including shortest path when loop is enabled).
 */
function navigateToStateIndex(slider, index) {
  const totalStates = slider?.states?.length || 0;
  if (!slider || totalStates <= 1) return;

  const idx = Math.max(0, Math.min(totalStates - 1, Math.floor(index)));
  const stateIndex = toNumber(slider.stateIndex, 0);
  if (idx === stateIndex) return;

  const loop = Boolean(slider.config?.loop);
  const diff = Math.abs(idx - stateIndex);
  const inverseDiff = totalStates - diff;
  const isDiffLargerThanHalf = diff > totalStates / 2;
  const scrollOpposite = isDiffLargerThanHalf && loop;

  if (idx > stateIndex) {
    if (scrollOpposite) {
      slider.prev?.(inverseDiff);
    } else {
      slider.next?.(diff);
    }
  } else if (scrollOpposite) {
    slider.next?.(inverseDiff);
  } else {
    slider.prev?.(diff);
  }
}

function stateIndexFromTrackClientX(clientX, barRect, totalStates) {
  if (totalStates <= 1) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - barRect.left) / barRect.width));
  return Math.round(ratio * (totalStates - 1));
}

function stateIndexFromThumbLeftPx(thumbLeftPx, barWidthPx, thumbWidthPx, totalStates) {
  if (totalStates <= 1) return 0;
  const travel = Math.max(0, barWidthPx - thumbWidthPx);
  if (travel <= 0) {
    const ratio = Math.min(1, Math.max(0, thumbLeftPx / Math.max(barWidthPx, 1)));
    return Math.round(ratio * (totalStates - 1));
  }
  const ratio = Math.min(1, Math.max(0, thumbLeftPx / travel));
  return Math.round(ratio * (totalStates - 1));
}

function applyInitialSlideFromDataset(element, instance) {
  if (!element || !instance) return;

  const requestedSlideIndex = toNumber(element?.dataset?.sliderInitial, 0);
  if (!Number.isFinite(requestedSlideIndex)) return;

  const totalSlides = toNumber(instance.totalSlides ?? instance.slides?.length, NaN);
  if (!Number.isFinite(totalSlides) || totalSlides < 1) return;

  const boundedSlideIndex = Math.max(0, Math.min(totalSlides - 1, Math.floor(requestedSlideIndex)));
  const targetStateIndex = resolveStateIndexForSlide(instance, boundedSlideIndex);
  if (!Number.isFinite(targetStateIndex)) return;

  navigateToStateIndex(instance, targetStateIndex);
}

class BlazeSliderController {
  constructor() {
    this.instances = new WeakMap();
    this.compatAdapters = new WeakMap();
    this.centerOffsetCleanups = new WeakMap();
    this.scrollbarCleanups = new WeakMap();
  }

  isCenteredModeActive(element) {
    const centeredMode = element?.dataset?.sliderCentered || "none";
    if (centeredMode === "both") return true;
    if (centeredMode === "mobile") return window.matchMedia("(max-width: 767.98px)").matches;
    if (centeredMode === "desktop") return window.matchMedia("(min-width: 768px)").matches;
    return false;
  }

  applyCenteredOffset(element) {
    if (!element) return;

    if (!this.isCenteredModeActive(element)) {
      element.style.setProperty("--blaze-centered-offset", "0px");
      return;
    }

    const trackContainer = element.querySelector(".blaze-track-container");
    const firstSlide = element.querySelector(".blaze-track > *");
    if (!trackContainer || !firstSlide) {
      element.style.setProperty("--blaze-centered-offset", "0px");
      return;
    }

    const containerWidth = trackContainer.getBoundingClientRect().width;
    const slideWidth = firstSlide.getBoundingClientRect().width;

    if (!Number.isFinite(containerWidth) || !Number.isFinite(slideWidth) || slideWidth <= 0) {
      element.style.setProperty("--blaze-centered-offset", "0px");
      return;
    }

    const centeredOffset = Math.max(0, (containerWidth - slideWidth) / 2);
    element.style.setProperty("--blaze-centered-offset", `${centeredOffset}px`);
  }

  bindCenteredOffset(element, instance) {
    if (!element || !instance) return;

    const existingCleanup = this.centerOffsetCleanups.get(element);
    if (existingCleanup) existingCleanup();

    const sync = () => this.applyCenteredOffset(element);
    const onSlideUnsubscribe = instance.onSlide?.(() => sync());

    const onResize = () => {
      requestAnimationFrame(() => sync());
    };

    window.addEventListener("resize", onResize);

    requestAnimationFrame(() => {
      sync();
      requestAnimationFrame(() => sync());
    });

    this.centerOffsetCleanups.set(element, () => {
      onSlideUnsubscribe?.();
      window.removeEventListener("resize", onResize);
      element.style.setProperty("--blaze-centered-offset", "0px");
    });
  }

  applyScrollbarProgress(element, instance) {
    if (!element || !instance) return;
    const scrollbar = element.querySelector("[data-blaze-scrollbar]");
    const thumb = element.querySelector("[data-blaze-scrollbar-thumb]");
    if (!scrollbar || !thumb) return;

    const totalStates = Math.max(1, instance.states?.length || 1);
    const noScroll = Boolean(instance.isStatic) || totalStates <= 1;

    if (noScroll) {
      scrollbar.hidden = true;
      scrollbar.setAttribute("aria-hidden", "true");
      thumb.style.width = "100%";
      thumb.style.left = "0%";
      return;
    }

    scrollbar.hidden = false;
    scrollbar.setAttribute("aria-hidden", "false");
    const currentStateIndex = Math.max(0, Math.min(totalStates - 1, toNumber(instance.stateIndex, 0)));
    const thumbWidth = 100 / totalStates;
    const progress = (currentStateIndex / (totalStates - 1)) * (100 - thumbWidth);

    thumb.style.width = `${thumbWidth}%`;
    thumb.style.left = `${progress}%`;
  }

  bindScrollbar(element, instance) {
    if (!element || !instance) return;

    const existingCleanup = this.scrollbarCleanups.get(element);
    if (existingCleanup) existingCleanup();

    const scrollbar = element.querySelector("[data-blaze-scrollbar]");
    const thumb = element.querySelector("[data-blaze-scrollbar-thumb]");

    let isScrollbarDragging = false;
    let documentDragAbort = null;

    const endDocumentDragListeners = () => {
      if (!documentDragAbort) return;
      documentDragAbort.abort();
      documentDragAbort = null;
    };

    const sync = () => {
      if (isScrollbarDragging) return;
      this.applyScrollbarProgress(element, instance);
    };

    const onSlideUnsubscribe = instance.onSlide?.(() => sync());
    const onResize = () => requestAnimationFrame(() => sync());

    window.addEventListener("resize", onResize);

    const setThumbVisualFromPointer = (clientX, dragPointerOffsetFromThumbLeft) => {
      if (!scrollbar || !thumb) return;
      const barRect = scrollbar.getBoundingClientRect();
      const thumbW = thumb.getBoundingClientRect().width;
      let thumbLeftPx = clientX - barRect.left - dragPointerOffsetFromThumbLeft;
      thumbLeftPx = Math.min(Math.max(0, thumbLeftPx), Math.max(0, barRect.width - thumbW));
      const leftPercent = barRect.width > 0 ? (thumbLeftPx / barRect.width) * 100 : 0;
      thumb.style.left = `${leftPercent}%`;
    };

    const startThumbDrag = (event) => {
      if (scrollbar.hidden) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const totalStates = instance.states?.length || 0;
      if (totalStates <= 1) return;

      event.preventDefault();

      const thumbRect = thumb.getBoundingClientRect();
      const dragPointerOffset = event.clientX - thumbRect.left;

      isScrollbarDragging = true;
      thumb.style.transition = "none";
      endDocumentDragListeners();

      const dragPointerId = event.pointerId;

      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== dragPointerId) return;
        setThumbVisualFromPointer(moveEvent.clientX, dragPointerOffset);
      };

      const endDrag = (endEvent) => {
        if (endEvent.pointerId !== dragPointerId) return;
        endDocumentDragListeners();

        const nextBarRect = scrollbar.getBoundingClientRect();
        const thumbW = thumb.getBoundingClientRect().width;
        let thumbLeftPx = endEvent.clientX - nextBarRect.left - dragPointerOffset;
        thumbLeftPx = Math.min(Math.max(0, thumbLeftPx), Math.max(0, nextBarRect.width - thumbW));
        const targetIndex = stateIndexFromThumbLeftPx(
          thumbLeftPx,
          nextBarRect.width,
          thumbW,
          totalStates
        );

        thumb.style.transition = "";
        isScrollbarDragging = false;
        navigateToStateIndex(instance, targetIndex);
        requestAnimationFrame(() => sync());
      };

      documentDragAbort = new AbortController();
      const { signal } = documentDragAbort;
      document.addEventListener("pointermove", onPointerMove, { signal });
      document.addEventListener("pointerup", endDrag, { signal });
      document.addEventListener("pointercancel", endDrag, { signal });
    };

    const onScrollbarPointerDown = (event) => {
      if (!scrollbar || !thumb) return;
      if (scrollbar.hidden) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const totalStates = instance.states?.length || 0;
      if (totalStates <= 1) return;

      if (event.target.closest("[data-blaze-scrollbar-thumb]")) {
        startThumbDrag(event);
        return;
      }

      const barRect = scrollbar.getBoundingClientRect();
      const targetIndex = stateIndexFromTrackClientX(event.clientX, barRect, totalStates);
      navigateToStateIndex(instance, targetIndex);
    };

    scrollbar?.addEventListener("pointerdown", onScrollbarPointerDown);

    requestAnimationFrame(() => {
      sync();
      requestAnimationFrame(() => sync());
    });

    this.scrollbarCleanups.set(element, () => {
      onSlideUnsubscribe?.();
      window.removeEventListener("resize", onResize);
      endDocumentDragListeners();
      scrollbar?.removeEventListener("pointerdown", onScrollbarPointerDown);
      if (thumb) {
        thumb.style.transition = "";
      }
      isScrollbarDragging = false;
    });
  }

  init(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return [];

    const sliders = root.matches?.("[data-blaze-slider]")
      ? [root]
      : Array.from(root.querySelectorAll("[data-blaze-slider]"));

    return sliders.map((slider) => this.initSlider(slider)).filter((instance) => Boolean(instance));
  }

  initSlider(element) {
    if (!element) return null;

    const existing = this.instances.get(element);
    if (existing) {
      try {
        existing.refresh?.();
        this.applyCenteredOffset(element);
        this.applyScrollbarProgress(element, existing);
        return existing;
      } catch (error) {
        console.warn("BlazeSliderController: failed to refresh existing slider", error);
      }
    }

    try {
      const normalizedConfig = normalizeConfig(readConfig(element));
      const totalSlides = getSliderSlideCount(element);
      const config = ensureLoopableConfig(normalizedConfig, totalSlides);
      const instance = new BlazeSlider(element, config);
      applyInitialSlideFromDataset(element, instance);
      this.instances.set(element, instance);
      element.__themeBlazeSlider = instance;
      const compat = this.createCompatAdapter(element, instance);
      element.slider = compat;
      element.dataset.sliderInitialized = "true";
      this.attachNavigation(element, instance);
      this.bindCenteredOffset(element, instance);
      this.bindScrollbar(element, instance);
      return instance;
    } catch (error) {
      console.warn("BlazeSliderController: failed to initialize slider", error);
      element.dataset.sliderInitialized = "false";
      return null;
    }
  }

  createCompatAdapter(element, instance) {
    const existing = this.compatAdapters.get(element);
    if (existing) return existing;

    const listeners = new Map();

    const getCurrentIndices = () => {
      const stateIndex = instance.stateIndex || 0;
      const state = instance.states?.[stateIndex];
      const page = Array.isArray(state?.page) ? state.page : [0, 0];
      const firstSlideIndex = toNumber(page[0], 0);
      const lastSlideIndex = toNumber(page[1], firstSlideIndex);

      return {
        stateIndex,
        firstSlideIndex,
        lastSlideIndex,
      };
    };

    const onSlideUnsubscribe = instance.onSlide?.((pageIndex, firstSlideIndex, lastSlideIndex) => {
      const indices = getCurrentIndices();
      const detail = {
        activeIndex: toNumber(firstSlideIndex, indices.firstSlideIndex),
        realIndex: toNumber(firstSlideIndex, indices.firstSlideIndex),
        stateIndex: toNumber(pageIndex, indices.stateIndex),
        firstSlideIndex: toNumber(firstSlideIndex, indices.firstSlideIndex),
        lastSlideIndex: toNumber(lastSlideIndex, indices.lastSlideIndex),
      };

      element.dispatchEvent(new CustomEvent("slidechange", { detail }));
      element.dispatchEvent(new CustomEvent("activeindexchange", { detail }));

      const slideChangeHandlers = listeners.get("slideChange") || new Set();
      slideChangeHandlers.forEach((cb) => cb(detail));

      const activeIndexHandlers = listeners.get("activeIndexChange") || new Set();
      activeIndexHandlers.forEach((cb) => cb(detail));
    });

    const adapter = {
      el: element,
      get activeIndex() {
        return getCurrentIndices().firstSlideIndex;
      },
      get realIndex() {
        return getCurrentIndices().firstSlideIndex;
      },
      update() {
        instance.refresh?.();
      },
      slideTo(targetIndex, _speed = 0) {
        const index = Number(targetIndex);
        if (!Number.isFinite(index)) return;

        const totalSlides = toNumber(instance.totalSlides ?? instance.slides?.length, NaN);
        if (!Number.isFinite(totalSlides) || totalSlides < 1) return;

        const boundedSlideIndex = Math.max(0, Math.min(totalSlides - 1, Math.floor(index)));

        const targetStateIndex = resolveStateIndexForSlide(instance, boundedSlideIndex);
        if (!Number.isFinite(targetStateIndex)) return;

        const current = instance.stateIndex || 0;
        if (targetStateIndex === current) return;

        const diff = targetStateIndex - current;
        if (diff > 0) {
          instance.next?.(diff);
        } else {
          instance.prev?.(Math.abs(diff));
        }
      },
      on(eventName, handler) {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, new Set());
        }
        listeners.get(eventName).add(handler);
      },
      off(eventName, handler) {
        const group = listeners.get(eventName);
        if (!group) return;
        group.delete(handler);
      },
      destroy() {
        onSlideUnsubscribe?.();
        listeners.clear();
        instance.destroy?.();
      },
    };

    this.compatAdapters.set(element, adapter);
    return adapter;
  }

  refresh(element) {
    if (!element) return null;
    const instance = this.instances.get(element);
    if (instance?.refresh) {
      instance.refresh();
      this.applyCenteredOffset(element);
      this.applyScrollbarProgress(element, instance);
      return instance;
    }
    return this.initSlider(element);
  }

  attachNavigation(element, instance) {
    if (!element || !instance) return;

    const scopeSelector = element.dataset.sliderNavScope;
    if (!scopeSelector) return;

    const scope = document.querySelector(scopeSelector);
    if (!scope) return;

    const nextSelector = element.dataset.sliderNavNext || ".blaze-button-next, .blaze-next";
    const prevSelector = element.dataset.sliderNavPrev || ".blaze-button-prev, .blaze-prev";

    const nextButtons = Array.from(scope.querySelectorAll(nextSelector));
    const prevButtons = Array.from(scope.querySelectorAll(prevSelector));

    if (!nextButtons.length && !prevButtons.length) return;

    const updateNavigationState = () => {
      const totalStates = instance.states?.length || 0;
      const currentStateIndex = instance.stateIndex || 0;
      const isLooping = Boolean(instance.config?.loop);
      const isStatic = Boolean(instance.isStatic) || totalStates <= 1;
      const isAtStart = !isStatic && currentStateIndex <= 0;
      const isAtEnd = !isStatic && currentStateIndex >= totalStates - 1;

      const setButtonState = (buttons, disabled) => {
        buttons.forEach((button) => {
          if (!button) return;

          if (disabled) {
            button.setAttribute("disabled", "");
            button.setAttribute("aria-disabled", "true");
          } else {
            button.removeAttribute("disabled");
            button.setAttribute("aria-disabled", "false");
          }
        });
      };

      if (isLooping) {
        setButtonState(prevButtons, isStatic);
        setButtonState(nextButtons, isStatic);
        return;
      }

      setButtonState(prevButtons, isStatic || isAtStart);
      setButtonState(nextButtons, isStatic || isAtEnd);
    };

    nextButtons.forEach((nextButton) => {
      if (!nextButton.classList.contains("blaze-next")) {
        nextButton.classList.add("blaze-next");
      }

      if (nextButton.__themeBlazeNavNextHandler) {
        nextButton.removeEventListener("click", nextButton.__themeBlazeNavNextHandler);
      }

      const handler = () => instance.next?.();
      nextButton.__themeBlazeNavNextHandler = handler;
      nextButton.addEventListener("click", handler);
      nextButton.dataset.blazeBound = "true";
    });

    prevButtons.forEach((prevButton) => {
      if (!prevButton.classList.contains("blaze-prev")) {
        prevButton.classList.add("blaze-prev");
      }

      if (prevButton.__themeBlazeNavPrevHandler) {
        prevButton.removeEventListener("click", prevButton.__themeBlazeNavPrevHandler);
      }

      const handler = () => instance.prev?.();
      prevButton.__themeBlazeNavPrevHandler = handler;
      prevButton.addEventListener("click", handler);
      prevButton.dataset.blazeBound = "true";
    });

    updateNavigationState();
    instance.onSlide?.(() => updateNavigationState());
  }

  destroy(element) {
    if (!element) return;
    const centeredOffsetCleanup = this.centerOffsetCleanups.get(element);
    if (centeredOffsetCleanup) centeredOffsetCleanup();
    const scrollbarCleanup = this.scrollbarCleanups.get(element);
    if (scrollbarCleanup) scrollbarCleanup();

    const compat = this.compatAdapters.get(element);
    if (compat?.destroy) compat.destroy();

    const instance = this.instances.get(element);
    if (instance?.destroy && !compat) instance.destroy();

    this.instances.delete(element);
    this.compatAdapters.delete(element);
    this.centerOffsetCleanups.delete(element);
    this.scrollbarCleanups.delete(element);
    element.__themeBlazeSlider = null;
    element.slider = null;
    element.dataset.sliderInitialized = "false";
  }
}

export const blazeSliderController = new BlazeSliderController();

if (typeof window !== "undefined") {
  window.themeBlazeSliderController = blazeSliderController;
}
