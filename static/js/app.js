(function () {
  "use strict";

  const menuToggle = document.getElementById("menuToggle");
  const siteNav = document.getElementById("siteNav");

  if (menuToggle && siteNav) {
    menuToggle.addEventListener("click", function () {
      const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!isOpen));
      siteNav.classList.toggle("is-open", !isOpen);
    });

    siteNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menuToggle.setAttribute("aria-expanded", "false");
        siteNav.classList.remove("is-open");
      });
    });
  }

  const uploadForm = document.getElementById("uploadForm");
  if (!uploadForm) {
    return;
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
  const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");
  const dzIdle = document.getElementById("dzIdle");
  const dzPreview = document.getElementById("dzPreview");
  const previewImg = document.getElementById("previewImg");
  const previewName = document.getElementById("previewName");
  const previewDetails = document.getElementById("previewDetails");
  const changeBtn = document.getElementById("changeBtn");
  const predictBtn = document.getElementById("predictBtn");
  const buttonContent = predictBtn.querySelector(".btn-content");
  const buttonLoading = predictBtn.querySelector(".btn-loading");
  const fileError = document.getElementById("fileError");

  let selectedFile = null;
  let previewUrl = "";
  let isSubmitting = false;

  fileInput.addEventListener("change", function (event) {
    const file = event.target.files && event.target.files[0];
    if (file) {
      selectFile(file, false);
    }
  });

  changeBtn.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (!isSubmitting) {
      fileInput.click();
    }
  });

  dropzone.addEventListener("keydown", function (event) {
    if ((event.key === "Enter" || event.key === " ") && !isSubmitting) {
      event.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      if (!isSubmitting) {
        dropzone.classList.add("dragover");
      }
    });
  });

  dropzone.addEventListener("dragleave", function (event) {
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove("dragover");
    }
  });

  dropzone.addEventListener("drop", function (event) {
    event.preventDefault();
    dropzone.classList.remove("dragover");

    if (isSubmitting) {
      return;
    }

    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      selectFile(file, true);
    }
  });

  uploadForm.addEventListener("submit", function (event) {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }

    if (!selectedFile) {
      event.preventDefault();
      showError("Upload a histopathology image before starting the analysis.");
      dropzone.focus();
      return;
    }

    const validationMessage = validateFile(selectedFile);
    if (validationMessage) {
      event.preventDefault();
      showError(validationMessage);
      return;
    }

    isSubmitting = true;
    predictBtn.disabled = true;
    dropzone.classList.add("is-submitting");
    dropzone.setAttribute("aria-busy", "true");
    buttonContent.hidden = true;
    buttonLoading.hidden = false;
  });

  function selectFile(file, cameFromDrop) {
    const validationMessage = validateFile(file);

    if (validationMessage) {
      showError(validationMessage);
      if (!selectedFile) {
        fileInput.value = "";
      }
      return;
    }

    if (cameFromDrop) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
    }

    selectedFile = file;
    clearError();
    updatePreview(file);
    predictBtn.disabled = false;
  }

  function validateFile(file) {
    const fileName = file.name.toLowerCase();
    const hasAcceptedExtension = ACCEPTED_EXTENSIONS.some(function (extension) {
      return fileName.endsWith(extension);
    });

    if (!ACCEPTED_TYPES.has(file.type) && !hasAcceptedExtension) {
      return "Choose a PNG, JPG, or JPEG histopathology image.";
    }

    if (file.size === 0) {
      return "The selected file is empty. Choose a different image.";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "The selected image is larger than 10 MB.";
    }

    return "";
  }

  function updatePreview(file) {
    releasePreviewUrl();
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
    previewName.textContent = truncateName(file.name, 48);
    previewDetails.textContent = formatBytes(file.size) + " · " + humanizeType(file);
    dzIdle.hidden = true;
    dzPreview.hidden = false;
    dropzone.classList.add("has-file");
  }

  function showError(message) {
    fileError.textContent = message;
    fileError.hidden = false;
    dropzone.classList.add("has-error");
  }

  function clearError() {
    fileError.textContent = "";
    fileError.hidden = true;
    dropzone.classList.remove("has-error");
  }

  function truncateName(name, maxLength) {
    if (name.length <= maxLength) {
      return name;
    }

    const extensionIndex = name.lastIndexOf(".");
    const extension = extensionIndex > -1 ? name.slice(extensionIndex) : "";
    return name.slice(0, maxLength - extension.length - 1) + "…" + extension;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function humanizeType(file) {
    return file.type ? file.type.replace("image/", "").toUpperCase() : "Image";
  }

  function releasePreviewUrl() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }
  }

  window.addEventListener("pageshow", function () {
    if (isSubmitting) {
      isSubmitting = false;
      predictBtn.disabled = !selectedFile;
      dropzone.classList.remove("is-submitting");
      dropzone.removeAttribute("aria-busy");
      buttonContent.hidden = false;
      buttonLoading.hidden = true;
    }
  });

  window.addEventListener("beforeunload", releasePreviewUrl);
})();
