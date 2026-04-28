export class ProductForm extends HTMLElement {
  constructor() {
    super();
    try {
      const rawJson = this.getAttribute("data-product-json");
      if (rawJson) {
        this.product_json = JSON.parse(rawJson);
      } else {
        this.product_json = null;
      }
    } catch (error) {
      console.error("ProductForm: Failed to parse product JSON:", error);
      console.error(
        "This usually indicates unescaped quotes in product data. Check the product title/description for special characters.",
      );
      this.product_json = null;
    }
    this.product_id = null;
    this.section_id = this.getAttribute("data-section-id") || null;
    this.enable_history = this.getAttribute("data-enable-history") === "true";
    this.stock_rules = {};
    this.master_select = null;
    this.quantity_selector = null;
    this.master_select_prefix = "product-id";
    this.radio = ".variant-selector-wrapper input[type=radio]";
    this.form = "form";
    this.gallery_root = null;
    this.gallery_slides = [];
    this.gallery_slider_instance = null;
    this.gallery_slider_listener_bound = false;
    this.gallery_slider_listener_attempts = 0;
    this.gallery_slider_listener_max_attempts = 20;
    this.gallery_slider_handler = null;
    this.gallery_slider_element = null;
    this.gallery_slider_element_listener_bound = false;
    this.option_selectors = null;
    this.slide_variant_map = new Map();
    this.is_gallery_selection = false;
    this.gallery_variant_handled = false;
    this.shopify_retry_count = 0;
    this.shopify_max_retries = 50; // Max 5 seconds (50 * 100ms)
    this.connectedCallback = false;
    this.quickview_link_selector = "[quickview-link]";
  }

  connectedCallback() {
    if (!this.product_json) {
      console.warn("ProductForm: No product JSON found");
      return;
    }

    this.product_id = this.product_json.id;
    this.master_select = this.querySelector('select[name="id"]');
    if (!this.master_select) {
      return;
    }
    this.quantity_selector = this.querySelector("[quantity-select]");
    this.variant_prices = this.querySelectorAll("[variant-price]");
    this.variant_sumbit_price = this.querySelectorAll("[data-variant-price-submit]");
    this.subtotal_el = this.querySelector("[product-sub-total]");
    this.maxtotal_el = this.querySelector("[product-max-total]");
    this.savingtotal_el = this.querySelector("[product-saving-total]");
    this.add_to_cart = this.querySelector("[add-to-cart]");
    this.add_to_cart_label = this.querySelector("[add-to-cart-label]");
    this.klaviyoVariantForm = this.querySelector("[klaviyo-sold-out-form]");
    this.paymentIcons = this.querySelector("[payment-icons]");
    this.refreshGalleryContext();
    this.text_add_to_cart = this.dataset.addToCart;
    this.text_sold_out = this.dataset.soldOut;
    this.text_unavailable = this.dataset.unavailable;
    this.money_format = this.dataset.moneyFormat;
    this.stockRules();
    this.shopifyOptionSelect();
    this.radiosOnChange();
    this.selectChange();
    this.initCustomDropdowns();
    this.updateOptionAvailability();
    this.bindGalleryVariantSync();
    this.setDefaultVariantOption();
    this.connectedCallback = true;
  }

  changeGridVariantImage(variant) {
    // Only run on desktop screens (width > 768px) for grid layouts
    if (window.innerWidth > 768) {
      const main_product = this.closest("#main-product");
      if (!main_product) {
        return;
      }

      // Check if we're in grid mode by looking for the desktop class on the Blaze slider
      const slider_container = main_product.querySelector(
        ".main-slider[data-blaze-slider].desktop",
      );
      if (!slider_container) {
        return;
      }

      // Find slide that contains this variant ID
      const variant_image_slides = main_product.querySelectorAll(".main-slider-slide[data-id]");
      let variant_image_slide = null;

      variant_image_slides.forEach((slide) => {
        const slideIds = slide.dataset.id.split(",").map((id) => id.trim());
        if (slideIds.includes(variant.id.toString())) {
          variant_image_slide = slide;
        }
      });

      if (!variant_image_slide) {
        return;
      }

      // Find the first image slide (typically has .first-image class or order: 1)
      const first_image_slide =
        main_product.querySelector(".main-slider-slide.first-image") ||
        main_product.querySelector('.main-slider-slide[style*="order: 1"]') ||
        main_product.querySelector(".main-slider-slide:first-child");

      if (!first_image_slide) {
        return;
      }

      if (variant_image_slide === first_image_slide) {
        return; // Already the first image, no swap needed
      }

      // Get the img elements from both slides
      const variant_img = variant_image_slide.querySelector("img");
      const first_img = first_image_slide.querySelector("img");

      if (!variant_img || !first_img) {
        return;
      }

      // Swap the image sources
      const variant_src = variant_img.src;
      const variant_srcset = variant_img.srcset || "";
      const first_src = first_img.src;
      const first_srcset = first_img.srcset || "";

      // Swap the data-id attributes (variant mapping)
      const variant_data_id = variant_image_slide.dataset.id;
      const first_data_id = first_image_slide.dataset.id;

      // Swap src attributes
      first_img.src = variant_src;
      variant_img.src = first_src;

      // Swap srcset attributes if they exist
      if (variant_srcset && first_srcset) {
        first_img.srcset = variant_srcset;
        variant_img.srcset = first_srcset;
      }

      // Swap data-id attributes to maintain variant mapping
      first_image_slide.dataset.id = variant_data_id;
      variant_image_slide.dataset.id = first_data_id;
    }
  }
  changeQuickviewLink(variant) {
    const quickview = this.closest("quick-view-inner");
    const productHandle = this.product_json ? this.product_json.handle : null;
    if (!quickview) {
      return;
    }
    const quickviewLinks = quickview.querySelectorAll(this.quickview_link_selector);
    if (!quickviewLinks.length) {
      return;
    }
    quickviewLinks.forEach((link) => {
      link.href = productHandle
        ? `${Shopify.routes.root}products/${productHandle}?variant=${variant.id}`
        : "";
    });
  }

  stockRules() {
    const select_options = this.master_select.querySelectorAll("option");
    if (select_options.length === 0) {
      console.error("Select options not found.");
      return;
    }
    select_options.forEach((option) => {
      if (
        option.dataset.inventoryManagement === "shopify" &&
        option.dataset.inventoryPolicy === "deny"
      ) {
        this.stock_rules[option.value] = option.dataset.inventoryQuantity;
      } else {
        this.stock_rules[option.value] = Number.MAX_SAFE_INTEGER;
      }
    });
  }

  changeSubmitPrice(variant) {
    if (!this.variant_sumbit_price.length > 1) {
      return;
    }
    this.variant_sumbit_price.forEach((price_el) => {
      const variantPrice = variant.price;
      let updatedPrice = variantPrice;
      price_el.dataset.price = updatedPrice;
      const priceFormatted = this.formatMoney(updatedPrice);
      price_el.innerHTML = `- ${priceFormatted}`;
    });
  }

  formatMoney(cents, format) {
    if (typeof cents === "string") {
      cents = cents.replace(".", "");
    }
    var value = "";
    var placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
    var formatString = format || this.money_format || window.Theme?.money_format || "${{amount}}";

    function defaultOption(opt, def) {
      return typeof opt === "undefined" ? def : opt;
    }

    function formatWithDelimiters(number, precision, thousands, decimal) {
      precision = defaultOption(precision, 2);
      thousands = defaultOption(thousands, ",");
      decimal = defaultOption(decimal, ".");
      if (isNaN(number) || number === null) {
        return 0;
      }
      number = (number / 100).toFixed(precision);
      var parts = number.split("."),
        dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + thousands),
        cents2 = parts[1] ? decimal + parts[1] : "";
      return dollars + cents2;
    }

    // Handle different format patterns
    var placeholder = formatString.match(placeholderRegex);
    if (!placeholder) {
      return formatString;
    }

    switch (placeholder[1]) {
      case "amount":
        value = formatWithDelimiters(cents, 2);
        break;
      case "amount_no_decimals":
        value = formatWithDelimiters(cents, 0);
        break;
      case "amount_with_comma_separator":
        value = formatWithDelimiters(cents, 2, ".", ",");
        break;
      case "amount_with_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ",");
        break;
      case "amount_with_period_and_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ".");
        break;
      case "amount_no_decimals_with_comma_separator":
        value = formatWithDelimiters(cents, 0, ".", ",");
        break;
      case "amount_no_decimals_with_space_separator":
        value = formatWithDelimiters(cents, 0, " ");
        break;
      case "amount_with_apostrophe_separator":
        value = formatWithDelimiters(cents, 2, "'", ".");
        break;
      default:
        value = formatWithDelimiters(cents, 2);
    }

    return formatString.replace(placeholderRegex, value);
  }

  changeVariantPrice(variant) {
    if (!this.variant_prices.length > 1) {
      return;
    }
    this.variant_prices.forEach((price_el) => {
      const variantID = parseInt(price_el.dataset.variantId);
      price_el.classList.add("hidden");

      if (variantID === variant.id) {
        price_el.classList.remove("hidden");
      }
    });
  }

  setSubmitButtonState(availability) {
    const submit = this.add_to_cart;
    const label = this.add_to_cart_label;
    const ADD_TO_CART = this.text_add_to_cart;
    const SOLD_OUT = this.text_sold_out;
    const UNAVAILABLE = this.text_unavailable;
    if (!submit) {
      console.error("Submit button not found.");
      return;
    }
    if (availability === true || availability === "true") {
      submit.value = ADD_TO_CART;
      submit.innerHTML = ADD_TO_CART;
      submit.removeAttribute("disabled");
      label.classList.remove("disabled");
    } else if (availability === "unavailable") {
      submit.value = UNAVAILABLE;
      submit.innerHTML = UNAVAILABLE;
      submit.setAttribute("disabled", "");
      label.classList.add("disabled");
    } else {
      submit.value = SOLD_OUT;
      submit.innerHTML = SOLD_OUT;
      submit.setAttribute("disabled", "");
      label.classList.add("disabled");
    }
  }

  setQuantityVisibility(availability) {
    if (!this.quantity_selector) {
      return;
    }
    const quantity_wrapper = this.quantity_selector.closest(".quantity-total-wrapper");
    if (!quantity_wrapper) {
      return;
    }

    if (availability === "unavailable" || availability === false) {
      quantity_wrapper.style.display = "none";
    } else {
      quantity_wrapper.style.display = "flex";
    }
  }

  setQuantityStock(variant) {
    if (!this.quantity_selector) {
      return;
    }
    const quantity_input = this.quantity_selector.querySelector("input");
    if (!quantity_input) {
      console.error("Quantity input not found.");
      return;
    }

    const max_stock = this.stock_rules[variant.id];
    quantity_input.max = max_stock;
  }

  setQuantityRules(quantity_rule) {
    if (!this.quantity_selector) {
      return;
    }
    const quantity_input = this.quantity_selector.querySelector("input");
    if (!quantity_input) {
      console.error("Quantity input not found.");
      return;
    }

    const quantity_number_el = this.quantity_selector.querySelector("[quantity]");
    if (!quantity_number_el) {
      console.error("Quantity number element not found.");
      return;
    }

    // Guard against undefined or null quantity_rule
    if (!quantity_rule) {
      quantity_input.min = quantity_input.value = quantity_number_el.innerHTML = 1;
      return;
    }

    if (quantity_rule.min) {
      quantity_input.min = quantity_input.value = quantity_number_el.innerHTML = quantity_rule.min;
    } else {
      quantity_input.min = quantity_input.value = quantity_number_el.innerHTML = 1;
    }
    if (quantity_rule.max) {
      quantity_input.max = quantity_rule.max;
    }
    if (quantity_rule.step) {
      quantity_input.step = quantity_rule.step;
    }
  }

  checkRadios(selector) {
    const selects = selector.selectors;
    const radios = this.querySelectorAll(this.radio);
    if (radios.length > 1) {
      selects.forEach((select) => {
        const select_index = select.index + 1;
        const selected_option_index = select.element.selectedIndex;
        const radio_to_check = this.querySelector(
          `.radio-option[data-option="${select_index}"] input[data-index="${selected_option_index}"]`,
        );
        if (radio_to_check) {
          radio_to_check.checked = true;
          radio_to_check.setAttribute("checked", true);
        } else {
          console.warn(`ProductForm: radio button for select ${select_index} not found.`);
        }
      });
    }
  }

  radiosOnChange() {
    // Wait for Shopify OptionSelectors to create the individual option selects
    setTimeout(() => {
      const radios = this.querySelectorAll(this.radio);

      if (radios.length > 0) {
        radios.forEach((radio) => {
          // Check if this radio button actually belongs to this product
          const radioProductId = radio.name.match(/-(\d+)-/);
          const extractedProductId = radioProductId ? radioProductId[1] : null;

          if (extractedProductId && extractedProductId !== this.product_id.toString()) {
            return;
          }

          radio.addEventListener("change", () => {
            const radioOption = radio.closest(".radio-option");

            if (!radioOption) {
              return;
            }

            const option_index = radioOption.dataset.option;
            if (!option_index) {
              return;
            }
            const option_value = radio.value;

            // Find the Shopify-generated select using the ID pattern we saw in console
            // option_index is "1", "2", "3" but Shopify uses 0-based indexing for IDs
            const selectId = `product-id-${this.section_id}-${this.product_id}-option-${parseInt(option_index) - 1}`;
            let select = this.querySelector(`#${selectId}`);

            if (!select) {
              // Fallback: try data-option attribute pattern within this product form
              select = this.querySelector(`select[data-option='option${option_index}']`);
            }

            if (!select) {
              // Final fallback: look for any select with this product's ID pattern
              select = this.querySelector(
                `select[id*="${this.product_id}"][id*="option-${parseInt(option_index) - 1}"]`,
              );
            }

            if (select) {
              select.value = option_value;
              // trigger change event
              const event = new Event("change");
              select.dispatchEvent(event);
            }

            // Update color name display if this is a color option
            this.updateColorName(radioOption, option_value);

            // Update availability after radio change
            this.updateOptionAvailability();
          });
        });
      }

      this.setDefaultVariantOption();
    }, 100); // Small delay to let Shopify create the selects
  }

  checkSelects(selector) {
    const selects = selector.selectors;
    const selectElements = this.querySelectorAll(".variant-selector-wrapper .select-option select");

    if (selectElements.length > 0) {
      selects.forEach((select) => {
        const select_index = select.index + 1;
        const selected_option_index = select.element.selectedIndex;
        const select_to_update = this.querySelector(
          `.select-option select[data-index="${select_index}"]`,
        );

        if (select_to_update) {
          // Get the value from the master select's selected option
          const selected_value = select.element.options[selected_option_index].value;
          select_to_update.value = selected_value;
        }
      });
    }
  }

  selectChange() {
    const selects = this.querySelectorAll(".variant-selector-wrapper .select-option select");
    if (selects.length === 0) {
      return;
    }
    // on change of this select find the corresponding select like in radioCheck and check it
    // const select = this.querySelector(`select[data-option='option${option_index}']`);
    selects.forEach((select) => {
      select.addEventListener("change", () => {
        // get value of selected option
        const selected_value = select.value;
        const option_index = select.dataset.index;
        const corresponding_select = this.querySelector(
          `select[data-option='option${option_index}']`,
        );
        if (corresponding_select) {
          corresponding_select.value = selected_value;
          // trigger change event
          const event = new Event("change");
          corresponding_select.dispatchEvent(event);
        } else {
          console.warn(`Select element for radio ${option_index} not found.`);
        }
        // Note: updateOptionAvailability() is called from radio change handler to avoid duplication
      });
    });
  }

  initCustomDropdowns() {
    const dropdowns = this.querySelectorAll(".dropdown-style .custom-dropdown");

    dropdowns.forEach((dropdown) => {
      const toggle = dropdown.querySelector(".dropdown-toggle");
      const options = dropdown.querySelector(".dropdown-options");
      const selectedText = toggle?.querySelector(".selected-text");
      const radioButtons = dropdown.querySelectorAll('input[type="radio"]');

      if (!toggle || !options) {
        return;
      }

      // Toggle dropdown on click
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Prevent rapid double-clicks
        if (toggle.dataset.processing === "true") {
          return;
        }
        toggle.dataset.processing = "true";

        setTimeout(() => {
          toggle.dataset.processing = "false";
        }, 100);

        // Close other dropdowns
        dropdowns.forEach((otherDropdown) => {
          if (otherDropdown !== dropdown) {
            const otherToggle = otherDropdown.querySelector(".dropdown-toggle");
            const otherOptions = otherDropdown.querySelector(".dropdown-options");
            otherToggle.classList.remove("open");
            otherOptions.classList.remove("open");
            otherOptions.classList.add("hidden");
            otherDropdown.classList.remove("dropdown-open");
          }
        });

        // Toggle current dropdown
        const isOpen = toggle.classList.contains("open");

        if (isOpen) {
          toggle.classList.remove("open");
          options.classList.remove("open");
          options.classList.add("hidden");
          dropdown.classList.remove("dropdown-open");
        } else {
          toggle.classList.add("open");
          options.classList.add("open");
          options.classList.remove("hidden");
          dropdown.classList.add("dropdown-open");
        }
      });

      // Handle option selection
      radioButtons.forEach((radio) => {
        radio.addEventListener("change", () => {
          if (radio.checked) {
            selectedText.textContent = radio.value;
            toggle.classList.remove("open");
            options.classList.remove("open");
            options.classList.add("hidden");
            dropdown.classList.remove("dropdown-open");
          }
        });
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".custom-dropdown")) {
        dropdowns.forEach((dropdown) => {
          const toggle = dropdown.querySelector(".dropdown-toggle");
          const options = dropdown.querySelector(".dropdown-options");
          toggle.classList.remove("open");
          options.classList.remove("open");
          options.classList.add("hidden");
          dropdown.classList.remove("dropdown-open");
        });
      }
    });
  }

  refreshGalleryContext() {
    if (typeof document === "undefined") {
      this.gallery_root = null;
      this.gallery_slides = [];
      return;
    }

    const previousRoot = this.gallery_root;
    const nextRoot = this.getGalleryRootElement();
    this.gallery_root = nextRoot;
    if (previousRoot !== this.gallery_root) {
      if (this.gallery_slider_element && this.gallery_slider_handler) {
        this.gallery_slider_element.removeEventListener("slidechange", this.gallery_slider_handler);
        this.gallery_slider_element.removeEventListener(
          "activeindexchange",
          this.gallery_slider_handler,
        );
      }
      this.gallery_slider_instance = null;
      this.gallery_slider_listener_bound = false;
      this.gallery_slider_handler = null;
      this.gallery_slider_element = null;
      this.gallery_slider_element_listener_bound = false;
      this.gallery_slider_listener_attempts = 0;
    }

    if (this.gallery_root && typeof this.gallery_root.querySelectorAll === "function") {
      // Only get slides from galleries that belong to our specific product
      const productGalleries = this.gallery_root.querySelectorAll(
        `[main-gallery] .main-slider[data-blaze-slider][data-product-id="${this.product_id}"]`,
      );
      this.gallery_slides = [];
      productGalleries.forEach((gallery) => {
        const slides = gallery.querySelectorAll(".main-slider-slide");
        this.gallery_slides.push(...slides);
      });
    } else {
      // If no specific gallery root found, don't control any gallery
      console.debug(
        `ProductForm: no specific gallery found for product ${this.product_id}, skipping gallery control`,
      );
      this.gallery_slides = [];
    }

    this.buildSlideVariantMap();
  }

  buildSlideVariantMap() {
    if (!this.slide_variant_map) {
      this.slide_variant_map = new Map();
    } else {
      this.slide_variant_map.clear();
    }

    const mediaList = Array.isArray(this.product_json?.media) ? this.product_json.media : [];
    if (!mediaList.length) {
      this.slide_variant_map.clear();
      return;
    }

    mediaList.forEach((media, index) => {
      if (!media || typeof media.id === "undefined") {
        return;
      }

      let variantIds = this.product_json.variants
        .filter((variant) => {
          const featuredMediaId = variant?.featured_media?.id;
          const featuredImageId = variant?.featured_image?.id;
          const legacyImageId = variant?.image_id || variant?.image?.id;
          return [featuredMediaId, featuredImageId, legacyImageId].some(
            (id) => id && id === media.id,
          );
        })
        .map((variant) => variant.id.toString());

      if (
        (!variantIds || variantIds.length === 0) &&
        this.gallery_slides &&
        typeof this.gallery_slides[index] !== "undefined"
      ) {
        const slide = this.gallery_slides[index];
        const rawIds = typeof slide?.dataset?.id === "string" ? slide.dataset.id : "";
        variantIds = rawIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }

      if (variantIds.length) {
        this.slide_variant_map.set(index, variantIds);
      }
    });
  }

  getGalleryRootElement() {
    if (typeof document === "undefined") {
      return null;
    }

    if (!this) {
      return document;
    }

    // Try to find a root that contains a gallery for this specific product
    const quickViewRoot = this.closest(".quick-view-wrapper, .quick-view-modal");
    if (quickViewRoot) {
      // Check if this quickview has a gallery for our product
      const galleryInQuickview = quickViewRoot.querySelector(
        `[main-gallery] .main-slider[data-blaze-slider][data-product-id="${this.product_id}"]`,
      );
      if (galleryInQuickview) {
        return quickViewRoot;
      }
    }

    const mainProductWrapper = this.closest("#main-product, #main-product-container");
    if (mainProductWrapper) {
      // Check if this main product wrapper has a gallery for our product
      const galleryInMain = mainProductWrapper.querySelector(
        `[main-gallery] .main-slider[data-blaze-slider][data-product-id="${this.product_id}"]`,
      );
      if (galleryInMain) {
        return mainProductWrapper;
      }
    }

    const sectionRoot = this.closest("[data-section-id]");
    if (sectionRoot && sectionRoot !== this) {
      // Check if this section has a gallery for our product
      const galleryInSection = sectionRoot.querySelector(
        `[main-gallery] .main-slider[data-blaze-slider][data-product-id="${this.product_id}"]`,
      );
      if (galleryInSection) {
        return sectionRoot;
      }
    }

    const generalSection = this.closest("section");
    if (generalSection) {
      // Check if this general section has a gallery for our product
      const galleryInGeneral = generalSection.querySelector(
        `[main-gallery] .main-slider[data-blaze-slider][data-product-id="${this.product_id}"]`,
      );
      if (galleryInGeneral) {
        return generalSection;
      }
    }
    return document;
  }

  resolveGalleryslider(root = this.gallery_root) {
    if (typeof document === "undefined") {
      return Promise.resolve(null);
    }

    if (
      this.gallery_slider_instance &&
      typeof this.gallery_slider_instance.slideTo === "function"
    ) {
      return Promise.resolve(this.gallery_slider_instance);
    }

    const idCandidates = [];
    if (this.section_id) {
      idCandidates.push(`product-main-slider-${this.section_id}`);
      idCandidates.push(`quick-main-slider-${this.section_id}`);
    }

    for (const candidate of idCandidates) {
      const byId = document.getElementById(candidate);
      if (byId && byId.slider && typeof byId.slider.slideTo === "function") {
        // Check if this gallery belongs to the current product
        const galleryProductId = byId.dataset.productId;
        if (galleryProductId && galleryProductId !== this.product_id.toString()) {
          continue;
        }
        this.gallery_slider_instance = byId.slider;
        return Promise.resolve(this.gallery_slider_instance);
      }
    }

    const searchRoot = root && typeof root.querySelector === "function" ? root : document;
    const selector = "[main-gallery] .main-slider[data-blaze-slider]";

    let sliderElement = searchRoot.querySelector(selector);

    if (!sliderElement && searchRoot !== document) {
      sliderElement = document.querySelector(selector);
    }

    if (sliderElement) {
      // Check if this gallery belongs to the current product
      const galleryProductId = sliderElement.dataset.productId;
      if (!galleryProductId) {
        console.debug(
          `ProductForm: gallery element has no product ID, skipping for product ${this.product_id}`,
        );
        return Promise.resolve(null);
      }
      if (galleryProductId !== this.product_id.toString()) {
        return Promise.resolve(null);
      }

      if (sliderElement.slider && typeof sliderElement.slider.slideTo === "function") {
        this.gallery_slider_instance = sliderElement.slider;
        return Promise.resolve(this.gallery_slider_instance);
      }

      if (sliderElement.slider && typeof sliderElement.slider.slideTo === "function") {
        this.gallery_slider_instance = sliderElement.slider;
        return Promise.resolve(this.gallery_slider_instance);
      }
    }

    return Promise.resolve(null);
  }

  bindGalleryVariantSync() {
    this.resolveGalleryslider(this.gallery_root).then((sliderInstance) => {
      if (!sliderInstance) {
        if (this.gallery_slider_listener_attempts < this.gallery_slider_listener_max_attempts) {
          this.gallery_slider_listener_attempts += 1;
          setTimeout(() => this.bindGalleryVariantSync(), 150);
        }
        return;
      }

      // Check if this gallery belongs to our product before binding
      const boundsliderElement = sliderInstance.el || sliderInstance.$el?.[0];
      if (boundsliderElement) {
        const galleryProductId = boundsliderElement.dataset.productId;

        if (!galleryProductId) {
          return;
        }

        if (galleryProductId !== this.product_id.toString()) {
          return;
        }
      }

      this.gallery_slider_listener_attempts = 0;

      const sliderSupportsEvents = typeof sliderInstance.on === "function";
      const previousHandler = this.gallery_slider_handler;
      const previousElement = this.gallery_slider_element;
      const handler = () => {
        this.handleGallerySlideChange(sliderInstance);
      };

      if (sliderSupportsEvents && typeof sliderInstance.off === "function" && previousHandler) {
        sliderInstance.off("slideChange", previousHandler);
        sliderInstance.off("activeIndexChange", previousHandler);
      }

      if (previousElement && previousHandler) {
        previousElement.removeEventListener("slidechange", previousHandler);
        previousElement.removeEventListener("activeindexchange", previousHandler);
      }

      this.gallery_slider_handler = handler;
      this.gallery_slider_listener_bound = true;

      if (sliderSupportsEvents) {
        sliderInstance.on("slideChange", handler);
        sliderInstance.on("activeIndexChange", handler);
      }

      const sliderElement = this.getGallerysliderElement(sliderInstance);
      if (sliderElement) {
        this.gallery_slider_element = sliderElement;
        this.gallery_slider_element.addEventListener("slidechange", handler);
        this.gallery_slider_element.addEventListener("activeindexchange", handler);
        this.gallery_slider_element_listener_bound = true;
      }

      // On load, sync the gallery to the currently selected variant instead of changing the variant
      const currentVariant = this.getCurrentVariant();
      if (currentVariant) {
        this.variantImageChange(currentVariant);
      }
    });
  }

  getGallerysliderElement(sliderInstance) {
    if (sliderInstance && sliderInstance.el instanceof HTMLElement) {
      return sliderInstance.el;
    }

    if (this.gallery_slider_element instanceof HTMLElement) {
      return this.gallery_slider_element;
    }

    const searchRoot =
      this.gallery_root && typeof this.gallery_root.querySelector === "function"
        ? this.gallery_root
        : document;
    return searchRoot.querySelector("[main-gallery] .main-slider[data-blaze-slider]");
  }

  handleGallerySlideChange(sliderInstance) {
    if (!sliderInstance || !this.master_select) {
      return;
    }

    // Check if this gallery slide change should affect this product
    const sliderElement = sliderInstance.el || sliderInstance.$el?.[0];
    if (sliderElement) {
      const galleryProductId = sliderElement.dataset.productId;
      if (galleryProductId && galleryProductId !== this.product_id.toString()) {
        return;
      }
    }

    if (!this.slide_variant_map || this.slide_variant_map.size === 0) {
      this.buildSlideVariantMap();
    }

    const indexCandidate =
      typeof sliderInstance.realIndex === "number"
        ? sliderInstance.realIndex
        : typeof sliderInstance.activeIndex === "number"
          ? sliderInstance.activeIndex
          : 0;

    let slideVariantIds =
      (this.slide_variant_map && this.slide_variant_map.get(indexCandidate)) || null;

    if (!slideVariantIds || slideVariantIds.length === 0) {
      const slidesArray = Array.from(this.gallery_slides || []);

      let activeSlide = null;
      for (const slide of slidesArray) {
        if (!slide || !slide.dataset) {
          continue;
        }
        const rawIndex = typeof slide.dataset.index === "string" ? slide.dataset.index.trim() : "";
        if (rawIndex && Number(rawIndex) === indexCandidate) {
          activeSlide = slide;
          break;
        }
      }

      if (!activeSlide && slidesArray.length > indexCandidate) {
        activeSlide = slidesArray[indexCandidate];
      }

      if (activeSlide && activeSlide.dataset) {
        slideVariantIds = (activeSlide.dataset.id || "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }
    }

    if (!slideVariantIds.length) {
      return;
    }

    const targetVariant = this.getBestMatchingVariant(slideVariantIds);
    if (!targetVariant) {
      return;
    }

    const targetIdString = targetVariant.id.toString();
    if (this.master_select.value === targetIdString) {
      return;
    }

    this.is_gallery_selection = true;

    const options = Array.from(this.master_select.options || []);
    const matchingOption = options.find((option) => option.value === targetIdString);
    if (matchingOption) {
      this.master_select.selectedIndex = options.indexOf(matchingOption);
    }
    this.master_select.value = targetIdString;

    const selectorContext =
      this.option_selectors && Array.isArray(this.option_selectors.selectors)
        ? this.option_selectors
        : { selectors: [] };

    try {
      this.gallery_variant_handled = false;

      if (this.option_selectors && typeof this.option_selectors.selectVariant === "function") {
        try {
          this.option_selectors.selectVariant(targetVariant);
        } catch (error) {
          console.warn("ProductFormVariantSelect: selectVariant failed", error);
        }
      } else {
        this.selectCallback(targetVariant, selectorContext);
        this.gallery_variant_handled = true;
      }

      if (!this.gallery_variant_handled) {
        this.selectCallback(targetVariant, selectorContext);
      }

      this.updateHistoryWithVariant(targetVariant);

      const changeEvent = new Event("change", { bubbles: true, cancelable: true });
      changeEvent.detail = { source: "gallery", variant: targetVariant };
      this.master_select.dispatchEvent(changeEvent);

      const syncControls = () => this.syncVariantOptionControls(targetVariant);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(syncControls);
      } else {
        setTimeout(syncControls, 0);
      }
    } finally {
      this.is_gallery_selection = false;
      this.gallery_variant_handled = false;
    }
  }

  updateHistoryWithVariant(variant) {
    if (!this.enable_history || typeof window === "undefined" || !variant || !variant.id) {
      return;
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", variant.id);
      window.history.replaceState(window.history.state, document.title, url.toString());
    } catch (error) {
      console.warn("ProductFormVariantSelect: failed to update history state", error);
    }
  }

  getBestMatchingVariant(variantIds) {
    if (!Array.isArray(variantIds) || variantIds.length === 0) {
      return null;
    }

    const currentSelections = this.getCurrentOptionSelections();
    let bestVariant = null;
    let bestScore = -1;

    variantIds.forEach((variantId) => {
      const variant = this.product_json.variants.find((v) => v.id.toString() === variantId);
      if (!variant) {
        return;
      }

      let score = 0;
      this.product_json.options.forEach((optionName, index) => {
        const optionPosition = (index + 1).toString();
        const variantValue = variant.options[index];
        if (
          currentSelections[optionPosition] &&
          currentSelections[optionPosition] === variantValue
        ) {
          score += 1;
        }
      });

      if (score > bestScore) {
        bestVariant = variant;
        bestScore = score;
      }
    });

    if (bestVariant) {
      return bestVariant;
    }

    const fallbackId = variantIds.find((id) =>
      this.product_json.variants.some((variant) => variant.id.toString() === id),
    );
    if (!fallbackId) {
      return null;
    }
    return (
      this.product_json.variants.find((variant) => variant.id.toString() === fallbackId) || null
    );
  }

  getCurrentOptionSelections() {
    const selections = {};

    if (!this) {
      return selections;
    }

    const radios = this.querySelectorAll(this.radio + ":checked");
    radios.forEach((radio) => {
      const optionWrapper = radio.closest(".radio-option");
      if (!optionWrapper) {
        return;
      }
      const optionPosition = optionWrapper.dataset.option;
      if (!optionPosition) {
        return;
      }
      selections[optionPosition] = radio.value;
    });

    const selects = this.querySelectorAll(".variant-selector-wrapper .select-option select");
    selects.forEach((select) => {
      const optionPosition = select.dataset.index || select.dataset.option;
      if (!optionPosition) {
        return;
      }
      if (select.value) {
        selections[optionPosition] = select.value;
      }
    });

    return selections;
  }

  variantImageChange(variant) {
    if (!variant || !this) {
      return;
    }

    if (this.is_gallery_selection) {
      return;
    }

    this.refreshGalleryContext();

    if (!this.gallery_slides || this.gallery_slides.length === 0) {
      return;
    }

    const if_card = this.getAttribute("data-card");
    if (if_card === "true") {
      return;
    }
    let targetIndex = null;
    const targetId = variant.id.toString();

    for (const [slideIndex, variantIds] of this.slide_variant_map.entries()) {
      if (variantIds.includes(targetId)) {
        targetIndex = slideIndex;
        break;
      }
    }

    if (targetIndex === null) {
      const slides = Array.from(this.gallery_slides || []);
      for (const slide of slides) {
        const rawIndex = typeof slide.dataset?.index === "string" ? slide.dataset.index.trim() : "";
        const rawIds = typeof slide.dataset?.id === "string" ? slide.dataset.id : "";
        if (!rawIndex || !rawIds) {
          continue;
        }
        const numericIndex = Number(rawIndex);
        if (Number.isNaN(numericIndex)) {
          continue;
        }
        const ids = rawIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        if (ids.includes(targetId)) {
          targetIndex = numericIndex;
          break;
        }
      }
    }

    if (targetIndex === null) {
      return;
    }

    this.resolveGalleryslider(this.gallery_root).then((sliderInstance) => {
      if (sliderInstance && typeof sliderInstance.slideTo === "function") {
        // Final check - make sure the slider element belongs to this product
        const sliderElement = sliderInstance.el || sliderInstance.$el?.[0];
        if (sliderElement) {
          const galleryProductId = sliderElement.dataset.productId;
          if (galleryProductId && galleryProductId !== this.product_id.toString()) {
            return;
          }
        }
        sliderInstance.slideTo(targetIndex, 500);
        return;
      }

      // no global fallback required; slider instance is attached directly to the gallery element
    });
  }

  initializeColorNames() {
    // Initialize color names for any pre-selected color options
    const colorOptions = this.querySelectorAll(".radio-option.swatch");
    colorOptions.forEach((colorOption) => {
      const selectedRadio = colorOption.querySelector('input[type="radio"]:checked');
      if (selectedRadio) {
        this.updateColorName(colorOption, selectedRadio.value);
      }
    });
  }

  updateLowStock(variant) {
    const lowStockContainer = this.querySelector("[low-stock-container]");

    if (!lowStockContainer) {
      return;
    }

    // Hide all low stock messaging first (icon + text pairs)
    const allLowStockNumbers = lowStockContainer.querySelectorAll("[low-stock-number]");
    const allLowStockIcons = lowStockContainer.querySelectorAll("[low-stock-icon]");

    allLowStockNumbers.forEach((element) => {
      element.classList.add("hidden");
    });

    allLowStockIcons.forEach((icon) => {
      icon.classList.add("hidden");
    });

    if (!variant) {
      // No variant selected, hide the entire container
      lowStockContainer.classList.add("hidden");
      return;
    }

    // Find the low stock message for this specific variant
    const variantLowStock = lowStockContainer.querySelector(`[data-variant-id="${variant.id}"]`);

    if (variantLowStock) {
      // Show the container and the specific variant's low stock message
      lowStockContainer.classList.remove("hidden");
      variantLowStock.classList.remove("hidden");

      // Reveal the icon paired with this variant message
      let iconCandidate = variantLowStock.previousElementSibling;
      while (iconCandidate && !iconCandidate.hasAttribute("low-stock-icon")) {
        iconCandidate = iconCandidate.previousElementSibling;
      }

      if (iconCandidate) {
        iconCandidate.classList.remove("hidden");
      }
    } else {
      // No low stock message for this variant, hide the container
      lowStockContainer.classList.add("hidden");
    }
  }
  updateColorName(radioOption, optionValue) {
    // Check if this is a color/swatch option
    if (radioOption.classList.contains("swatch")) {
      const colorNameSpan = radioOption.querySelector("[variant-colour-name]");
      if (colorNameSpan) {
        colorNameSpan.textContent = optionValue;
      }
    }
  }

  updateOptionAvailability() {
    // Get currently selected options from the master select (most reliable source)
    const currentSelections = {};

    // First try to get selections from the currently selected variant
    if (this.master_select && this.master_select.value) {
      const selectedOption = this.master_select.options[this.master_select.selectedIndex];
      if (selectedOption && selectedOption.dataset) {
        // Parse the variant options from the selected option
        for (let i = 1; i <= 3; i++) {
          // Shopify typically has max 3 options
          const optionKey = `option${i}`;
          if (selectedOption.dataset[optionKey]) {
            currentSelections[i.toString()] = selectedOption.dataset[optionKey];
          }
        }
      }
    }

    // Fallback: Get selections from checked radio buttons
    if (Object.keys(currentSelections).length === 0) {
      const radios = this.querySelectorAll(this.radio + ":checked");
      radios.forEach((radio) => {
        const optionPosition = radio.closest(".radio-option").dataset.option;
        currentSelections[optionPosition] = radio.value;
      });

      // Also check select dropdowns
      const selects = this.querySelectorAll(".variant-selector-wrapper .select-option select");
      selects.forEach((select) => {
        const optionPosition = select.dataset.index;
        if (select.value) {
          currentSelections[optionPosition] = select.value;
        }
      });
    }

    // Clear all existing availability classes from radio buttons
    const allRadios = this.querySelectorAll(this.radio);
    allRadios.forEach((radio) => {
      const wrapper = radio.closest(".variant-wrapper");
      if (wrapper) {
        wrapper.classList.remove("out-of-stock", "unavailable-combination");
      }
    });

    // Clear all existing availability classes from select options
    const allSelectOptions = this.querySelectorAll(
      ".variant-selector-wrapper .select-option select option",
    );
    allSelectOptions.forEach((option) => {
      option.classList.remove("out-of-stock", "unavailable-combination");
    });

    // Check each radio button for availability
    allRadios.forEach((radio) => {
      // Only modify radio buttons that belong to this product
      const radioProductId = radio.name.match(/-(\d+)-/);
      const extractedProductId = radioProductId ? radioProductId[1] : null;

      if (extractedProductId && extractedProductId !== this.product_id.toString()) {
        return; // Skip radio buttons from other products
      }

      const optionPosition = radio.closest(".radio-option").dataset.option;
      const optionValue = radio.value;
      const wrapper = radio.closest(".variant-wrapper");

      if (!wrapper) return;

      // Create a test selection with this radio button's value
      const testSelections = { ...currentSelections };
      testSelections[optionPosition] = optionValue;

      // Check if any variant exists with this combination
      const hasAvailableVariant = this.product_json.variants.some((variant) => {
        // Check if this variant matches our test selections
        const variantMatches = this.product_json.options.every((option, index) => {
          const optionPos = (index + 1).toString();
          if (!testSelections[optionPos]) return true; // No selection for this option yet
          return variant.options[index] === testSelections[optionPos];
        });

        return variantMatches && variant.available;
      });

      const hasAnyVariant = this.product_json.variants.some((variant) => {
        // Check if this variant matches our test selections
        const variantMatches = this.product_json.options.every((option, index) => {
          const optionPos = (index + 1).toString();
          if (!testSelections[optionPos]) return true; // No selection for this option yet
          return variant.options[index] === testSelections[optionPos];
        });

        return variantMatches;
      });

      // Apply appropriate classes
      if (!hasAnyVariant) {
        wrapper.classList.add("unavailable-combination");
      } else if (!hasAvailableVariant) {
        wrapper.classList.add("out-of-stock");
      }
    });

    // Check each select option for availability
    const selects = this.querySelectorAll(".variant-selector-wrapper .select-option select");
    selects.forEach((select) => {
      const optionPosition = select.dataset.index;
      const options = select.querySelectorAll("option");

      options.forEach((option) => {
        if (!option.value) return; // Skip empty option

        const optionValue = option.value;

        // Create a test selection with this option's value
        const testSelections = { ...currentSelections };
        testSelections[optionPosition] = optionValue;

        // Check if any variant exists with this combination
        const hasAvailableVariant = this.product_json.variants.some((variant) => {
          // Check if this variant matches our test selections
          const variantMatches = this.product_json.options.every((optionName, index) => {
            const optionPos = (index + 1).toString();
            if (!testSelections[optionPos]) return true; // No selection for this option yet
            return variant.options[index] === testSelections[optionPos];
          });

          return variantMatches && variant.available;
        });

        const hasAnyVariant = this.product_json.variants.some((variant) => {
          // Check if this variant matches our test selections
          const variantMatches = this.product_json.options.every((optionName, index) => {
            const optionPos = (index + 1).toString();
            if (!testSelections[optionPos]) return true; // No selection for this option yet
            return variant.options[index] === testSelections[optionPos];
          });

          return variantMatches;
        });

        // Apply appropriate classes without disabling
        if (!hasAnyVariant) {
          option.classList.add("unavailable-combination");
        } else if (!hasAvailableVariant) {
          option.classList.add("out-of-stock");
        }
      });
    });
  }

  toggleKlaviyoForm(variant) {
    if (!this.klaviyoVariantForm) {
      return;
    }
    if (!variant || variant === null) {
      this.klaviyoVariantForm.classList.add("hidden");
    } else {
      if (!variant.available) {
        this.klaviyoVariantForm.classList.remove("hidden");
        if (this.paymentIcons) {
          this.paymentIcons.classList.add("hidden");
        }
      } else {
        this.klaviyoVariantForm.classList.add("hidden");
        if (this.paymentIcons) {
          this.paymentIcons.classList.remove("hidden");
        }
      }
    }
  }

  selectCallback(variant, selector) {
    console.debug("ProductForm selectCallback", variant);
    // AVAILABILITY STATES
    const AVAILABILITY_AVAILABLE = true;
    const AVAILABILITY_UNAVAILABLE = "unavailable";
    const AVAILABILITY_SOLD_OUT = "sold_out";

    // SUBMIT BUTTON STATE - Changes submit button text and state based on variant availability
    if (!variant) {
      this.setSubmitButtonState(AVAILABILITY_UNAVAILABLE);
      this.setQuantityVisibility(AVAILABILITY_UNAVAILABLE);
      this.toggleKlaviyoForm(false);
      return;
    }

    if (variant.available) {
      this.setSubmitButtonState(AVAILABILITY_AVAILABLE);
      this.setQuantityVisibility(AVAILABILITY_AVAILABLE);
    } else {
      this.setSubmitButtonState(AVAILABILITY_SOLD_OUT);
      this.setQuantityVisibility(AVAILABILITY_SOLD_OUT);
    }

    // CHECK RADIOS - checks radio buttons based on option select element
    this.checkRadios(selector);
    // CHECK SELECTS - checks select elements based on option select element
    this.checkSelects(selector);
    // QUANTITY RULES IF PRESENT - Adds min and max attributes to quantity input
    this.setQuantityStock(variant);
    // SET PRICE - Sets price based on variant
    this.setQuantityRules(variant.quantity_rule);
    // SET STOCK - Sets max stock attribute to quantity input
    this.changeVariantPrice(variant);
    this.changeSubmitPrice(variant);
    // SET IMAGE - Changes main image based on variant
    this.variantImageChange(variant);
    // UPDATE LOW STOCK - Shows/hides low stock notification based on variant
    this.updateLowStock(variant);
    // UPDATE OPTION AVAILABILITY - Updates radio button classes based on stock
    this.updateOptionAvailability(variant);
    // SYNC VISIBLE CONTROLS - Keep radios/selects in sync after programmatic changes
    this.syncVariantOptionControls(variant);
    this.changeQuickviewLink(variant);
    this.changeGridVariantImage(variant);
    this.toggleKlaviyoForm(variant);
  }

  shopifyOptionSelect() {
    // Check if Shopify.OptionSelectors is available
    if (typeof Shopify === "undefined" || typeof Shopify.OptionSelectors !== "function") {
      // Retry with exponential backoff, up to max retries
      if (this.shopify_retry_count < this.shopify_max_retries) {
        this.shopify_retry_count++;
        setTimeout(() => this.shopifyOptionSelect(), 100);
        return;
      } else {
        console.error("ProductForm: Shopify.OptionSelectors not available after maximum retries");
        return;
      }
    }

    // Reset retry count on success
    this.shopify_retry_count = 0;

    console.debug(
      "ProductForm: initializing Shopify.OptionSelectors for",
      this.master_select_prefix + "-" + this.section_id + "-" + this.product_id,
    );

    this.option_selectors = new Shopify.OptionSelectors(
      this.master_select_prefix + "-" + this.section_id + "-" + this.product_id,
      {
        product: this.product_json,
        onVariantSelected: this.selectCallback.bind(this),
        enableHistoryState: this.enable_history,
      },
    );
    this.bindGalleryVariantSync();
  }

  syncVariantOptionControls(variant) {
    if (!variant || !Array.isArray(variant.options) || !this) {
      return;
    }

    const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

    variant.options.forEach((optionValue, index) => {
      const optionPosition = (index + 1).toString();
      const normalizedValue = normalize(optionValue);

      const radioOptions = this.querySelectorAll(
        `.radio-option[data-option="${optionPosition}"] input[type="radio"]`,
      );
      radioOptions.forEach((radio) => {
        // Only modify radio buttons that belong to this product
        const radioProductId = radio.name.match(/-(\d+)-/);
        const extractedProductId = radioProductId ? radioProductId[1] : null;

        if (extractedProductId && extractedProductId !== this.product_id.toString()) {
          return; // Skip radio buttons from other products
        }

        const matches = normalize(radio.value) === normalizedValue;
        radio.checked = matches;
        if (matches) {
          radio.setAttribute("checked", "true");
        } else {
          radio.removeAttribute("checked");
        }
      });

      const dropdownToggle = this.querySelector(
        `.dropdown-style [data-option="${optionPosition}"]`,
      );
      if (dropdownToggle) {
        const selectedTextEl = dropdownToggle.querySelector(".selected-text");
        if (selectedTextEl) {
          selectedTextEl.textContent = optionValue;
        }
      }

      const selectElement = this.querySelector(
        `.variant-selector-wrapper .select-option select[data-index="${optionPosition}"]`,
      );
      if (selectElement && normalize(selectElement.value) !== normalizedValue) {
        selectElement.value = optionValue;
      }

      const shopifySelect = this.querySelector(
        `#${this.master_select_prefix}-${this.section_id}-${this.product_id}-option-${index}`,
      );
      if (shopifySelect && normalize(shopifySelect.value) !== normalizedValue) {
        shopifySelect.value = optionValue;
      }
    });

    this.initializeColorNames();
  }

  setDefaultVariantOption() {
    if (this.connectedCallback === false) {
      return;
    }
    this.querySelectorAll("input[default-variant-option]").forEach((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change"));
    });
  }

  getCurrentVariant() {
    if (!this.master_select || !this.product_json) {
      return null;
    }

    const selectedVariantId = this.master_select.value;
    return this.product_json.variants.find(
      (variant) => variant.id.toString() === selectedVariantId,
    );
  }

  updateSubmitPrice() {
    const currentVariant = this.getCurrentVariant();
    if (currentVariant) {
      this.changeSubmitPrice(currentVariant);
    }
  }
}

customElements.define("product-form", ProductForm);
