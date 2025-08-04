// Startup Landing Page JavaScript

// Navigation functionality
document.addEventListener("DOMContentLoaded", () => {
  const navbar = document.querySelector(".navbar")
  const navToggle = document.getElementById("nav-toggle")
  const navMenu = document.getElementById("nav-menu")

  // Navbar scroll effect
  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      navbar.classList.add("scrolled")
    } else {
      navbar.classList.remove("scrolled")
    }
  })

  // Mobile menu toggle
  if (navToggle) {
    navToggle.addEventListener("click", () => {
      navMenu.classList.toggle("active")
      navToggle.classList.toggle("active")
    })
  }

  // Smooth scrolling for navigation links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault()
      const target = document.querySelector(this.getAttribute("href"))
      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      }
    })
  })

  // Initialize animations
  initializeAnimations()

  // Initialize feature card interactions
  initializeFeatureCards()

  // Initialize loading states
  initializeLoadingStates()
})

// Main navigation functions

function startDemo() {
  showNotification("Starting demo experience...", "info")
  showLoading()

  setTimeout(() => {
    redirectToLogin()
  }, 2000)
}

function watchVideo() {
  showNotification("Demo video coming soon!", "info")
}

function redirectToLogin() {
  showNotification("Redirecting to login...", "info")
  setTimeout(() => {
    window.location.href = "login.html"
  }, 1000)
}

// Loading functionality
function showLoading() {
  const overlay = document.getElementById("loading-overlay")
  if (overlay) {
    overlay.classList.add("show")
  }
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay")
  if (overlay) {
    overlay.classList.remove("show")
  }
}

// Notification system
function showNotification(message, type = "info") {
  const notification = document.createElement("div")
  notification.className = `notification ${type}`

  const icon = getNotificationIcon(type)
  const color = getNotificationColor(type)

  notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
            <button class="notification-close" onclick="closeNotification(this)">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `

  // Style the notification
  notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${color};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        max-width: 400px;
        min-width: 300px;
        backdrop-filter: blur(10px);
    `

  document.body.appendChild(notification)

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      closeNotification(notification.querySelector(".notification-close"))
    }
  }, 5000)
}

function getNotificationIcon(type) {
  const icons = {
    success: "check-circle",
    error: "exclamation-circle",
    warning: "exclamation-triangle",
    info: "info-circle",
  }
  return icons[type] || "info-circle"
}

function getNotificationColor(type) {
  const colors = {
    success: "linear-gradient(135deg, #10b981, #059669)",
    error: "linear-gradient(135deg, #ef4444, #dc2626)",
    warning: "linear-gradient(135deg, #f59e0b, #d97706)",
    info: "linear-gradient(135deg, #2563eb, #1d4ed8)",
  }
  return colors[type] || colors.info
}

function closeNotification(button) {
  const notification = button.closest(".notification")
  notification.style.animation = "slideOutRight 0.3s ease"
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification)
    }
  }, 300)
}

// Animation initialization
function initializeAnimations() {
  // Intersection Observer for scroll animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1"
        entry.target.style.transform = "translateY(0)"

        // Add stagger effect for feature cards
        if (entry.target.classList.contains("feature-card")) {
          const delay = Array.from(entry.target.parentNode.children).indexOf(entry.target) * 100
          entry.target.style.transitionDelay = `${delay}ms`
        }
      }
    })
  }, observerOptions)

  // Observe elements for animation
  const animatedElements = document.querySelectorAll(".feature-card, .benefit-item, .hero-visual")
  animatedElements.forEach((el) => {
    el.style.opacity = "0"
    el.style.transform = "translateY(30px)"
    el.style.transition = "all 0.6s ease"
    observer.observe(el)
  })
}

// Feature card interactions
function initializeFeatureCards() {
  const featureCards = document.querySelectorAll(".feature-card")

  featureCards.forEach((card) => {
    card.addEventListener("mouseenter", function () {
      // Add hover effect to icon
      const icon = this.querySelector(".feature-icon")
      if (icon) {
        icon.style.transform = "scale(1.1) rotate(5deg)"
      }
    })

    card.addEventListener("mouseleave", function () {
      // Reset icon
      const icon = this.querySelector(".feature-icon")
      if (icon) {
        icon.style.transform = "scale(1) rotate(0deg)"
      }
    })

    card.addEventListener("click", function () {
      // Add click effect
      this.style.transform = "translateY(-8px) scale(0.98)"
      setTimeout(() => {
        this.style.transform = "translateY(-8px) scale(1)"
      }, 150)

      // Show feature details
      const title = this.querySelector(".feature-title").textContent
      showNotification(`${title} feature details coming soon!`, "info")
    })
  })
}

// Loading states for buttons
function initializeLoadingStates() {
  const buttons = document.querySelectorAll("button[onclick]")

  buttons.forEach((button) => {
    button.addEventListener("click", function () {
      if (!this.classList.contains("loading")) {
        this.classList.add("loading")
        const originalText = this.innerHTML

        // Add loading spinner
        this.innerHTML = `
                    <div class="button-spinner"></div>
                    <span>Loading...</span>
                `

        // Reset after 3 seconds
        setTimeout(() => {
          this.classList.remove("loading")
          this.innerHTML = originalText
        }, 3000)
      }
    })
  })
}

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  // Close notifications with Escape
  if (e.key === "Escape") {
    const notifications = document.querySelectorAll(".notification")
    notifications.forEach((notification) => {
      const closeButton = notification.querySelector(".notification-close")
      if (closeButton) {
        closeNotification(closeButton)
      }
    })
  }

  // Quick navigation with keyboard shortcuts
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case "1":
        e.preventDefault()
        document.querySelector("#features").scrollIntoView({ behavior: "smooth" })
        break
      case "2":
        e.preventDefault()
        document.querySelector("#benefits").scrollIntoView({ behavior: "smooth" })
        break
      case "3":
        e.preventDefault()
        document.querySelector("#contact").scrollIntoView({ behavior: "smooth" })
        break
    }
  }
})

// Performance monitoring
function trackPerformance() {
  // Track page load time
  window.addEventListener("load", () => {
    const loadTime = performance.now()
    console.log(`Page loaded in ${loadTime.toFixed(2)}ms`)

    // Track to analytics (placeholder)
    trackEvent("page_load", {
      load_time: loadTime,
      page: "landing",
    })
  })

  // Track user interactions
  document.addEventListener("click", (e) => {
    const target = e.target.closest("button, a, .feature-card")
    if (target) {
      const elementText = target.textContent.trim()
      trackEvent("element_click", {
        element: target.tagName.toLowerCase(),
        text: elementText,
        page: "landing",
      })
    }
  })
}

// Analytics tracking (placeholder)
function trackEvent(eventName, properties = {}) {
  // In production, integrate with your analytics service
  console.log("Event tracked:", eventName, properties)

  // Example integrations:
  // Google Analytics 4: gtag('event', eventName, properties);
  // Custom analytics: analytics.track(eventName, properties);
}

// Initialize performance tracking
trackPerformance()

// Add CSS for dynamic styles
const dynamicStyles = document.createElement("style")
dynamicStyles.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .notification-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 5px;
        margin-left: auto;
        opacity: 0.8;
        transition: opacity 0.3s ease;
        border-radius: 4px;
    }
    
    .notification-close:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
    }
    
    .nav-menu.active {
        display: flex;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        flex-direction: column;
        padding: 1rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        border-radius: 0 0 12px 12px;
    }
    
    .nav-toggle.active span:nth-child(1) {
        transform: rotate(45deg) translate(5px, 5px);
    }
    
    .nav-toggle.active span:nth-child(2) {
        opacity: 0;
    }
    
    .nav-toggle.active span:nth-child(3) {
        transform: rotate(-45deg) translate(7px, -6px);
    }
    
    @media (max-width: 768px) {
        .nav-menu {
            display: none;
        }
    }
`

document.head.appendChild(dynamicStyles)

// Initialize everything when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    console.log("FaceAttend Landing Page initialized successfully!")
  })
} else {
  console.log("FaceAttend Landing Page initialized successfully!")
}

// Export functions for global access
window.FaceAttendLanding = {
  startDemo,
  watchVideo,
  showNotification,
  trackEvent,
}
