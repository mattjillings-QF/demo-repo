import { ModalController } from "@theme/modal-controller";

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded and parsed");
  const modal = document.querySelector('[data-modal="product-modal-upsell"]');
  if (!modal) return;
  window.modal = new ModalController();

  const closeModal = () => {
    window.modal.hideModal("product-modal-upsell");
  };

  modal.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  const addBothBtn = modal.querySelector(".add--to-cart");

  const variantCards = modal.querySelectorAll("variant-card");
  if (addBothBtn) {
    addBothBtn.addEventListener("click", async () => {
      const variantCards = modal.querySelectorAll("variant-card");
      const itemsToAdd = [];

      if (modal.dataset.prodItem) {
        const mainProduct = JSON.parse(modal.dataset.prodItem);
        if (mainProduct.items?.length) {
          itemsToAdd.push(...mainProduct.items);
        }
      }

      for (const card of variantCards) {
        const select = card.querySelector('.variant-selector-wrapper [name="id"]');
        let id = null;
        const quantity = 1;
        if (select) {
          let selectedOption = select.selectedOptions[0];
          id = selectedOption?.getAttribute("value");
        } else {
          let selectedRadio = card.querySelector("product-form input");
          if (!selectedRadio) {
            return;
          }
          id = selectedRadio.value;
        }

        const properties = {};
        card.querySelectorAll(".property").forEach((field) => {
          const key = field.getAttribute("name");
          const value = field.value;
          if (key && value) properties[key] = value;
        });

        if (id && quantity > 0) {
          itemsToAdd.push({ id, quantity, properties });
        }
      }

      if (itemsToAdd.length > 0) {
        await window.cart.add({ items: itemsToAdd });
      }
      closeModal();
    });
  }

  const continueBtn = modal.querySelector(".continue");
  if (continueBtn) {
    continueBtn.addEventListener("click", async () => {
      if (modal.dataset.prodItem) {
        const mainProduct = JSON.parse(modal.dataset.prodItem);
        if (mainProduct.items?.length) {
          await window.cart.add({ items: [...mainProduct.items] });
        }
      }
      closeModal();
    });
  }

  // Function to calculate total
  function updateTotal() {
    const mainPrice = parseInt(modal.dataset.mainPrice, 10) || 0;
    let total = mainPrice;
    console.log("Main product price:", mainPrice);
    variantCards.forEach((card) => {
      const selected = card.querySelector('input[type="radio"]:checked');
      console.log("Selected variant price:", selected?.dataset.price);
      if (selected && selected.dataset.price) {
        total += parseInt(selected.dataset.price, 10);
      }
    });

    const formatted = (total / 100).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
    });
    const addBoth = modal.querySelector(".add--to-cart");
    addBoth.querySelector(".add-both-price").textContent = `- ${formatted}`;
  }

  // Add listeners for changes on all variant radios
  modal.addEventListener("change", (e) => {
    console.log("Change event detected:", e.target);
    if (e.target.matches('input[type="radio"]')) {
      updateTotal();
    }
  });
});
