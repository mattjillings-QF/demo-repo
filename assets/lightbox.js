import { ModalController } from "@theme/modal-controller";

const getOrCreateModalController = () => {
  if (window.__quickfireModalController) {
    return window.__quickfireModalController;
  }
  const instance = new ModalController();
  window.__quickfireModalController = instance;
  return instance;
};

class LightboxInstance {
  constructor(modalEl, modalController) {
    this.modalEl = modalEl;
    this.modalController = modalController;
    this.modalId = modalEl?.dataset?.modal || null;
    if (!this.modalId) return;
    if (modalEl.dataset.lightboxBound === "true") return;

    this.sliderEl = modalEl.querySelector(".lightbox-slider[data-blaze-slider]");

    const triggers = Array.from(
      document.querySelectorAll(`[data-lightbox-trigger][data-modal-trigger="${this.modalId}"]`),
    );
    this.triggers = triggers.filter((trigger) => trigger.dataset.lightboxBound !== "true");

    if (!this.triggers.length) return;

    this.scrollLocked = false;
    this.isActive = false;
    this.openCheckTimer = null;
    this.handleTrigger = this.handleTrigger.bind(this);
    this.handleModalClosed = this.handleModalClosed.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);

    this.triggers.forEach((trigger) => {
      trigger.addEventListener("click", this.handleTrigger);
      trigger.dataset.lightboxBound = "true";
    });

    window.addEventListener(`${this.modalId}-modal-closed`, this.handleModalClosed);
    modalEl.dataset.lightboxBound = "true";
  }

  handleTrigger(event) {
    const trigger = event.currentTarget;
    const activeIndex = parseInt(trigger.getAttribute("data-slide-index")) || 0;
    this.lockScroll();

    if (this.modalEl) {
      window.requestAnimationFrame(() => {
        this.modalEl.style.removeProperty("background");
      });
    }

    const showClass = this.modalController?.showClass || "active";
    if (this.openCheckTimer) {
      window.clearTimeout(this.openCheckTimer);
    }
    this.openCheckTimer = window.setTimeout(() => {
      if (!this.modalEl?.classList.contains(showClass)) {
        this.unlockScroll();
      }
      this.openCheckTimer = null;
    }, 400);

    this.initslider().then((slider) => {
      if (!slider) return;
      try {
        slider.update();
      } catch { }
      if (typeof activeIndex === "number" && !Number.isNaN(activeIndex)) {
        slider.slideTo(activeIndex, 0, false);
      }
      if (slider.zoom && typeof slider.zoom.out === "function") {
        try {
          slider.zoom.out();
        } catch { }
      }
      this.isActive = true;
      document.addEventListener("keydown", this.handleKeydown);
      const closeBtn = this.modalEl?.querySelector(".product-lightbox-modal__close");
      if (closeBtn && typeof closeBtn.focus === "function") {
        setTimeout(() => closeBtn.focus(), 150);
      }
    });
  }

  resolveActiveIndex(selector) {
    if (!selector) return 0;
    try {
      const sliderHost = document.querySelector(selector);
      const sliderInstance = sliderHost?.slider;
      if (!sliderInstance) return 0;
      if (typeof sliderInstance.realIndex === "number") return sliderInstance.realIndex;
      if (typeof sliderInstance.activeIndex === "number") return sliderInstance.activeIndex;
    } catch { }
    return 0;
  }

  async initslider() {
    if (!this.sliderEl) return null;
    if (this.sliderEl.slider) return this.sliderEl.slider;

    const controller = window.themeBlazeSliderController;
    if (controller?.refresh) {
      controller.refresh(this.sliderEl);
    }

    let attempts = 0;
    while (!this.sliderEl.slider && attempts < 10) {
      // wait for async slider init
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => requestAnimationFrame(resolve));
      attempts += 1;
    }

    if (this.sliderEl.slider && typeof this.sliderEl.slider.update === "function") {
      try {
        this.sliderEl.slider.update();
      } catch { }
    }

    return this.sliderEl.slider || null;
  }

  handleModalClosed() {
    this.unlockScroll();
    if (this.openCheckTimer) {
      window.clearTimeout(this.openCheckTimer);
      this.openCheckTimer = null;
    }
    if (!this.isActive) return;
    this.isActive = false;
    document.removeEventListener("keydown", this.handleKeydown);
  }

  handleKeydown(event) {
    if (event.key !== "Escape" || !this.isActive) return;
    event.preventDefault();
    if (this.modalId) {
      this.modalController.hideModal(this.modalId);
    }
  }

  lockScroll() {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    this.previousOverflowHtml = document.documentElement.style.overflow;
    this.previousOverflowBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  unlockScroll() {
    if (!this.scrollLocked) return;
    if (this.openCheckTimer) {
      window.clearTimeout(this.openCheckTimer);
      this.openCheckTimer = null;
    }
    document.documentElement.style.overflow = this.previousOverflowHtml || "";
    document.body.style.overflow = this.previousOverflowBody || "";
    this.scrollLocked = false;
  }
}

class LightboxController {
  constructor(root = document) {
    this.root = root;
    this.modalController = getOrCreateModalController();
    this.instances = [];
    this.mount();
  }

  mount() {
    const modals = Array.from(this.root.querySelectorAll("[data-lightbox-modal]"));
    if (!modals.length) return;
    modals.forEach((modal) => {
      const instance = new LightboxInstance(modal, this.modalController);
      if (instance && instance.triggers?.length) {
        this.instances.push(instance);
      }
    });
  }
}

const bootstrap = (root = document) => {
  if (!root) return;
  if (!window.__quickfireLightbox) {
    window.__quickfireLightbox = new LightboxController(root);
  } else {
    window.__quickfireLightbox.mount();
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bootstrap());
} else {
  bootstrap();
}

document.addEventListener("shopify:section:load", (event) => {
  const container = event?.target || document;
  bootstrap(container);
});

export { LightboxController };
