// Контент-скрипт для добавления стоимости бензина на Yandex Maps

(function() {
  'use strict';

  const {
    normalizeStoredNumber,
    extractDistanceKm,
    calculateFuelCost,
    formatCost,
    normalizeUiText,
    isPureDistanceText,
    scoreDistanceCandidateText,
    resolveSettingsButtonPosition,
  } = globalThis.FuelCalcCore;

  // Настройки по умолчанию
  const DEFAULT_FUEL_PRICE = 50; // руб/литр
  const DEFAULT_FUEL_CONSUMPTION = 8; // литров на 100 км

  // Состояние
  let fuelPrice = DEFAULT_FUEL_PRICE;
  let fuelConsumption = DEFAULT_FUEL_CONSUMPTION;
  let settingsPanel = null;
  let routeObserver = null;
  let uiObserver = null;
  let spaObserver = null;
  let updateTimeout = null;
  let routeUpdateTimeout = null;
  let isUpdating = false;
  let clickOutsideHandlerAttached = false;
  let pendingRouteCards = new Set();

  // Константы селекторов и таймаутов
  const DOM_RULES = {
    routeCardExact: ['.auto-route-snippet-view'],
    routeCardFallback: ['[class*="route-snippet"]', '[class*="snippet-view"]'],
    routeDistanceExact: ['.auto-route-snippet-view__distance'],
    routeDistanceFallback: ['[class*="distance"]', '[aria-label*="км"]', '[aria-label*="м"]'],
    routeSummaryHints: [
      '[class*="route"][class*="snippet"]',
      '[class*="route"][class*="distance"]',
      '[class*="route"][class*="duration"]',
    ],
    detailedRouteContainers: [
      '[class*="route-panel"]',
      '[class*="route-details"]',
      '[class*="route-instructions"]',
      '[class*="route-panel__content"]',
    ],
    detailedRouteChildren: [
      '[class*="instruction"]',
      '[class*="direction"]',
      '[class*="step"]',
      '[class*="maneuver"]',
      '[class*="route-instruction"]',
      '[class*="route-step-view"]',
    ],
  };
  const DEBUG_DOM_BREAKAGE = false;
  const SETTINGS_PANEL_ID = 'fuel-cost-settings';
  const SETTINGS_BUTTON_ID = 'fuel-settings-button';
  const SETTINGS_BUTTON_FALLBACK_RECT = { top: 100, right: 20 };
  const SETTINGS_BUTTON_SIZE = 44;
  const SETTINGS_BUTTON_GAP = 8;
  const SIDEBAR_TOGGLE_ANCHOR_SELECTOR = '.sidebar-toggle-button._name_routes';
  const ROUTE_INPUT_KEYWORDS = ['откуда', 'куда'];
  const BUILD_ROUTE_TEXT = 'построить маршрут';
  const detailedRouteContainerSelector = DOM_RULES.detailedRouteContainers.join(',');
  const detailedRouteChildSelector = DOM_RULES.detailedRouteChildren.join(',');

  const DEBOUNCE_MS = 500;
  const INPUT_DEBOUNCE_MS = 800;
  const INITIAL_UPDATE_DELAY_MS = 1000;
  let buttonPositionTimeout = null;

  function debugDom(event, details = {}) {
    if (!DEBUG_DOM_BREAKAGE) return;
    console.debug('[ymaps-fuel-calc]', event, details);
  }

  function queryAll(selectors, root = document) {
    const results = [];
    const seen = new Set();

    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((node) => {
        if (!seen.has(node)) {
          seen.add(node);
          results.push(node);
        }
      });
    }

    return results;
  }

  function getRouteLikeText(node) {
    const text = normalizeUiText(node?.textContent || '');
    const ariaLabel = normalizeUiText(node?.getAttribute?.('aria-label') || '');

    if (!ariaLabel || text.includes(ariaLabel)) {
      return text;
    }

    return text ? normalizeUiText(`${text} ${ariaLabel}`) : ariaLabel;
  }

  function getDistanceText(node) {
    const text = normalizeUiText(node?.textContent || '');
    if (extractDistanceKm(text) !== null) {
      return text;
    }

    const ariaLabel = normalizeUiText(node?.getAttribute?.('aria-label') || '');
    return extractDistanceKm(ariaLabel) !== null ? ariaLabel : text || ariaLabel;
  }

  function looksLikeRouteSummary(node) {
    if (!node) return false;
    if (node.matches?.(DOM_RULES.routeCardExact.join(','))) return true;

    const routeText = getRouteLikeText(node);
    if (extractDistanceKm(routeText) === null) return false;

    return Boolean(
      node.matches?.('[class*="route-snippet"]')
      || node.closest?.('[class*="route-snippet"]')
      || node.matches?.('[class*="auto-route"]')
      || node.closest?.('[class*="auto-route"]')
      || node.querySelector?.(DOM_RULES.routeSummaryHints.join(','))
    );
  }

  function isDetailedRouteCard(routeCard) {
    if (!routeCard) return false;
    if (routeCard.matches?.(DOM_RULES.routeCardExact.join(','))) return false;
    if (routeCard.closest?.(detailedRouteChildSelector)) return true;

    const isDetailedRoute = routeCard.closest(detailedRouteContainerSelector);
    if (isDetailedRoute && routeCard.querySelector(detailedRouteChildSelector)) {
      return true;
    }

    const parentContainer = routeCard.closest('[class*="panel"], [class*="Panel"]');
    return Boolean(parentContainer?.querySelector(detailedRouteChildSelector) && !looksLikeRouteSummary(routeCard));
  }

  function findRouteCards(root = document) {
    const exactCards = queryAll(DOM_RULES.routeCardExact, root);
    if (exactCards.length > 0) return exactCards;

    const fallbackCards = queryAll(DOM_RULES.routeCardFallback, root)
      .filter((card) => looksLikeRouteSummary(card));
    if (fallbackCards.length > 0) return fallbackCards;

    const distanceNodes = queryAll(DOM_RULES.routeDistanceFallback, root);
    const derivedCards = [];
    const seen = new Set();

    for (const node of distanceNodes) {
      const card = node.closest(DOM_RULES.routeCardFallback.join(','));
      if (card && looksLikeRouteSummary(card) && !seen.has(card)) {
        seen.add(card);
        derivedCards.push(card);
      }
    }

    return derivedCards;
  }

  // Загрузка настроек из storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['fuelPrice', 'fuelConsumption']);
      fuelPrice = normalizeStoredNumber(result.fuelPrice, DEFAULT_FUEL_PRICE);
      fuelConsumption = normalizeStoredNumber(result.fuelConsumption, DEFAULT_FUEL_CONSUMPTION);
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
    }
  }

  // Сохранение настроек в storage
  async function saveSettings(price, consumption) {
    try {
      await chrome.storage.local.set({
        fuelPrice: price,
        fuelConsumption: consumption
      });
      fuelPrice = price;
      fuelConsumption = consumption;
      updateAllRoutes();
    } catch (error) {
      console.error('Ошибка сохранения настроек:', error);
    }
  }

  // Поиск элемента с расстоянием в карточке маршрута
  function findDistanceElement(routeCard) {
    const exactMatches = queryAll(DOM_RULES.routeDistanceExact, routeCard)
      .filter((el) => extractDistanceKm(el.textContent || '') !== null);

    if (exactMatches.length > 0) {
      return exactMatches[0];
    }

    const fallbackMatches = queryAll(DOM_RULES.routeDistanceFallback, routeCard)
      .map((el) => {
        return {
          el,
          text: getDistanceText(el),
        };
      })
      .filter(({ text }) => extractDistanceKm(text) !== null)
      .filter(({ el, text }) => {
        if (isPureDistanceText(text)) return true;
        return queryAll(DOM_RULES.routeDistanceFallback, el).length === 0;
      })
      .sort((a, b) => scoreDistanceCandidateText(b.text) - scoreDistanceCandidateText(a.text));

    return fallbackMatches[0]?.el || null;
  }

  // Добавление стоимости бензина к маршруту
  function addFuelCostToRoute(routeCard) {
    // Проверяем, не добавлена ли уже стоимость в этой карточке
    if (routeCard.querySelector('.fuel-cost-display')) {
      return;
    }
    
    // Обрабатываем только карточки маршрутов (список вариантов маршрутов)
    const routeContainer = routeCard.closest(DOM_RULES.routeCardExact.join(','))
      || routeCard.closest(DOM_RULES.routeCardFallback.join(','));
    if (!routeContainer) {
      return;
    }

    if (!looksLikeRouteSummary(routeCard)) {
      return;
    }
    
    // Не добавляем стоимость внутри панели настроек
    if (routeCard.id === SETTINGS_PANEL_ID || routeCard.closest(`#${SETTINGS_PANEL_ID}`)) {
      return;
    }
    
    // Не показываем стоимость в детальном маршруте (где показываются направления)
    // Проверяем, находится ли элемент в детальном виде маршрута
    if (isDetailedRouteCard(routeCard)) {
      return;
    }

    const distanceEl = findDistanceElement(routeCard);
    if (!distanceEl) {
      const routeText = getRouteLikeText(routeCard);
      if (routeText.includes('км') || routeText.includes(' м')) {
        debugDom('distance-not-found', {
          routeText: routeText.slice(0, 200),
          selectors: [...DOM_RULES.routeDistanceExact, ...DOM_RULES.routeDistanceFallback],
        });
      }
      return;
    }

    const distanceText = getDistanceText(distanceEl);
    const distance = extractDistanceKm(distanceText);
    if (distance === null) return;

    const cost = calculateFuelCost(distance, fuelPrice, fuelConsumption);
    if (cost === null) return;

    // Создаем элемент для отображения стоимости (в стиле платных дорог)
    const costElement = document.createElement('div');
    costElement.className = 'fuel-cost-display';
    // Добавляем data-атрибут для идентификации как элемента расширения (не рекламы)
    costElement.setAttribute('data-extension', 'ymaps-fuel-calc');
    costElement.setAttribute('data-non-ad', 'true');
    costElement.setAttribute('aria-label', `Стоимость топлива: ${formatCost(cost)}`);
    
    // Создаем структуру как у платных дорог: иконка + текст
    costElement.innerHTML = `
      <span class="fuel-cost-badge">
        <span class="fuel-cost-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="M7 3.75a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h4.4a1 1 0 0 0 1-1v-8.5a1 1 0 0 0-1-1H7Zm.4 1.45h3.8v2.4H7.4V5.2Zm.35 3.55a.65.65 0 0 0-.65.65v2.75c0 .36.29.65.65.65h2.95c.36 0 .65-.29.65-.65V9.4a.65.65 0 0 0-.65-.65H7.75Z" fill="currentColor"/>
            <path d="M12.85 5h.8c.5 0 .9.4.9.9v2.35c0 .24.1.48.27.65l.42.42c.5.49.76 1.15.76 1.84v2.02a.9.9 0 0 1-1.8 0v-2.1a.78.78 0 0 0-.23-.56l-.5-.49a2 2 0 0 1-.62-1.45V5Z" fill="currentColor"/>
          </svg>
        </span>
        <span class="fuel-cost-text">${formatCost(cost)}</span>
      </span>
    `;

    // Вставляем стоимость рядом с расстоянием (в той же строке)
    // Ищем родительский элемент, который содержит расстояние
    const parent = distanceEl.parentElement;
    if (parent) {
      // Пытаемся вставить сразу после элемента с расстоянием
      // Если это inline элемент, вставляем рядом
      if (distanceEl.nextSibling) {
        distanceEl.parentNode.insertBefore(costElement, distanceEl.nextSibling);
      } else {
        distanceEl.parentNode.appendChild(costElement);
      }
    } else {
      // Fallback: вставляем после элемента
      distanceEl.parentNode.insertBefore(costElement, distanceEl.nextSibling);
    }
  }

  function clearRouteCardCost(routeCard) {
    routeCard.querySelectorAll('.fuel-cost-display').forEach((el) => el.remove());
  }

  function updateRouteCard(routeCard) {
    if (!looksLikeRouteSummary(routeCard)) {
      return;
    }

    clearRouteCardCost(routeCard);
    addFuelCostToRoute(routeCard);
  }

  // Обновление всех маршрутов
  function updateAllRoutes() {
    // Защита от множественных одновременных обновлений
    if (isUpdating) return;
    isUpdating = true;

    try {
      // Сначала удаляем все старые элементы стоимости
      document.querySelectorAll('.fuel-cost-display').forEach(el => el.remove());

      const routeCards = findRouteCards();
      if (routeCards.length === 0) {
        return;
      }

      routeCards.forEach((routeCard) => updateRouteCard(routeCard));
    } finally {
      isUpdating = false;
    }
  }

  // Обновление с debounce для оптимизации
  function scheduleUpdate(delay = DEBOUNCE_MS) {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }
    updateTimeout = setTimeout(() => {
      updateAllRoutes();
    }, delay);
  }

  function scheduleRouteUpdate(routeCards, delay = DEBOUNCE_MS) {
    for (const routeCard of routeCards) {
      pendingRouteCards.add(routeCard);
    }

    if (routeUpdateTimeout) {
      clearTimeout(routeUpdateTimeout);
    }

    routeUpdateTimeout = setTimeout(() => {
      const cards = Array.from(pendingRouteCards).filter((card) => card.isConnected);
      pendingRouteCards.clear();
      routeUpdateTimeout = null;

      if (cards.length === 0) return;

      cards.forEach((card) => updateRouteCard(card));
    }, delay);
  }

  function getVisibleAnchorRect(anchor) {
    if (!anchor || !anchor.isConnected) return null;

    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function findSettingsButtonAnchor() {
    return document.querySelector(SIDEBAR_TOGGLE_ANCHOR_SELECTOR);
  }

  function positionSettingsButton() {
    const button = document.getElementById(SETTINGS_BUTTON_ID);
    if (!button) return;

    const anchorRect = getVisibleAnchorRect(findSettingsButtonAnchor());
    const position = resolveSettingsButtonPosition(
      anchorRect,
      SETTINGS_BUTTON_FALLBACK_RECT,
      { buttonSize: SETTINGS_BUTTON_SIZE, gap: SETTINGS_BUTTON_GAP }
    );

    button.classList.toggle('_anchored', position.mode === 'anchored');
    button.style.top = `${position.top}px`;

    if (position.mode === 'anchored') {
      button.style.left = `${position.left}px`;
      button.style.right = 'auto';
      return;
    }

    button.style.left = 'auto';
    button.style.right = `${position.right}px`;
  }

  function scheduleButtonPositionUpdate(delay = DEBOUNCE_MS) {
    if (buttonPositionTimeout) {
      clearTimeout(buttonPositionTimeout);
    }

    buttonPositionTimeout = setTimeout(() => {
      buttonPositionTimeout = null;
      positionSettingsButton();
    }, delay);
  }

  function toggleSettingsPanel(event) {
    event.preventDefault();
    event.stopPropagation();

    const panel = createSettingsPanel();
    if (panel.style.display === 'none' || !panel.style.display) {
      panel.style.display = 'block';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';
      return;
    }

    panel.style.display = 'none';
  }

  // Создание панели настроек
  function createSettingsPanel() {
    if (settingsPanel && settingsPanel.isConnected) return settingsPanel;
    settingsPanel = null;

    const panel = document.createElement('div');
    panel.id = SETTINGS_PANEL_ID;
    panel.className = 'fuel-cost-settings';
    // Добавляем data-атрибуты для идентификации как элемента расширения (не рекламы)
    panel.setAttribute('data-extension', 'ymaps-fuel-calc');
    panel.setAttribute('data-non-ad', 'true');

    panel.innerHTML = `
      <div class="fuel-cost-title">Настройки расчёта топлива</div>
      <div class="fuel-cost-field">
        <label for="fuel-price-input">Цена топлива (₽/литр):</label>
        <input type="number" id="fuel-price-input" value="${fuelPrice}" min="0" step="0.1">
      </div>
      <div class="fuel-cost-field">
        <label for="fuel-consumption-input">Расход топлива (л/100км):</label>
        <input type="number" id="fuel-consumption-input" value="${fuelConsumption}" min="0" step="0.1">
      </div>
      <button id="fuel-settings-apply" class="fuel-cost-apply">Применить</button>
      <button id="fuel-settings-toggle" class="fuel-cost-close" aria-label="Закрыть">×</button>
    `;

    document.body.appendChild(panel);

    // Обработчики событий
    const priceInput = panel.querySelector('#fuel-price-input');
    const consumptionInput = panel.querySelector('#fuel-consumption-input');
    const applyBtn = panel.querySelector('#fuel-settings-apply');
    const toggleBtn = panel.querySelector('#fuel-settings-toggle');

    applyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const price = parseFloat(priceInput.value);
      const consumption = parseFloat(consumptionInput.value);
      
      if (isNaN(price) || price < 0 || isNaN(consumption) || consumption < 0) {
        alert('Пожалуйста, введите корректные значения');
        return;
      }
      
      saveSettings(price, consumption);
      panel.style.display = 'none';
    });

    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.style.display = 'none';
    });
    
    // Закрытие при клике вне панели (вешаем один раз)
    if (!clickOutsideHandlerAttached) {
      document.addEventListener('click', (e) => {
        if (panel && panel.style.display === 'block') {
          if (!panel.contains(e.target) && e.target.id !== SETTINGS_BUTTON_ID) {
            panel.style.display = 'none';
          }
        }
      });
      clickOutsideHandlerAttached = true;
    }

    // Применение при Enter
    [priceInput, consumptionInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          applyBtn.click();
        }
      });
    });

    settingsPanel = panel;
    return panel;
  }

  // Создание кнопки для открытия настроек
  function createSettingsButton() {
    // Проверяем, не создана ли уже кнопка
    if (document.getElementById(SETTINGS_BUTTON_ID)) {
      scheduleButtonPositionUpdate(0);
      return;
    }
    
    // Кнопка создается всегда, независимо от наличия маршрутов

    const button = document.createElement('button');
    button.id = SETTINGS_BUTTON_ID;
    button.className = 'fuel-settings-button';
    // Добавляем data-атрибуты для идентификации как элемента расширения (не рекламы)
    button.setAttribute('data-extension', 'ymaps-fuel-calc');
    button.setAttribute('data-non-ad', 'true');
    button.innerHTML = '⛽';
    button.title = 'Настройки расчёта топлива';
    button.setAttribute('aria-label', 'Настройки расчёта топлива');
    button.addEventListener('click', toggleSettingsPanel);

    document.body.appendChild(button);
    positionSettingsButton();
  }

  function refreshExtensionUi() {
    createSettingsButton();
    createSettingsPanel();
    scheduleButtonPositionUpdate(0);
  }

  function cleanupObservers() {
    if (routeObserver) {
      routeObserver.disconnect();
      routeObserver = null;
    }
    if (uiObserver) {
      uiObserver.disconnect();
      uiObserver = null;
    }
    if (spaObserver) {
      spaObserver.disconnect();
      spaObserver = null;
    }
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
    if (routeUpdateTimeout) {
      clearTimeout(routeUpdateTimeout);
      routeUpdateTimeout = null;
    }
    if (buttonPositionTimeout) {
      clearTimeout(buttonPositionTimeout);
      buttonPositionTimeout = null;
    }
    pendingRouteCards.clear();
  }

  // Находим корневой контейнер списка маршрутов, чтобы сузить наблюдение
  function getRoutePanelRoot() {
    const [routeCard] = findRouteCards();
    return routeCard?.parentElement || null;
  }

  // Доп. триггер обновления при изменении полей адреса или клике на "Построить маршрут"
  function attachRouteInputListeners() {
    const inputs = Array.from(document.querySelectorAll('input')).filter(input => {
      const aria = (input.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
      return ROUTE_INPUT_KEYWORDS.some(k => aria.includes(k) || placeholder.includes(k));
    });
    inputs.forEach(input => {
      if (!input.dataset.fuelCalcBound) {
        input.addEventListener('change', () => scheduleUpdate(INPUT_DEBOUNCE_MS));
        input.addEventListener('input', () => scheduleUpdate(INPUT_DEBOUNCE_MS));
        input.dataset.fuelCalcBound = '1';
      }
    });

    const buildButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const text = (btn.textContent || '').toLowerCase();
      return text.includes(BUILD_ROUTE_TEXT);
    });
    buildButtons.forEach(btn => {
      if (!btn.dataset.fuelCalcBound) {
        btn.addEventListener('click', () => scheduleUpdate(INPUT_DEBOUNCE_MS));
        btn.dataset.fuelCalcBound = '1';
      }
    });
  }

  // Инициализация
  async function init() {
    await loadSettings();

    refreshExtensionUi();
    
    // Скрываем панель настроек по умолчанию
    if (settingsPanel) {
      settingsPanel.style.display = 'none';
      settingsPanel.style.visibility = 'visible';
      settingsPanel.style.opacity = '1';
    }
    
    // Убеждаемся, что кнопка видна и работает
    const button = document.getElementById(SETTINGS_BUTTON_ID);
    if (button) {
      button.style.display = 'flex';
      button.style.visibility = 'visible';
      button.style.opacity = '1';
      scheduleButtonPositionUpdate(0);
    } else {
      // Если кнопка не создалась, пробуем еще раз через небольшую задержку
      setTimeout(() => {
        refreshExtensionUi();
      }, DEBOUNCE_MS);
    }

    // Наблюдаем за изменениями DOM
    routeObserver = new MutationObserver((mutations) => {
      const routeCardsToRefresh = new Set();

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.id === SETTINGS_PANEL_ID || node.id === SETTINGS_BUTTON_ID) continue;
          if (node.classList?.contains('fuel-cost-display')) continue;

          findRouteCards(node).forEach((card) => routeCardsToRefresh.add(card));

          const parentRouteCard = node.closest?.(DOM_RULES.routeCardExact.join(','))
            || node.closest?.(DOM_RULES.routeCardFallback.join(','));
          if (parentRouteCard) {
            routeCardsToRefresh.add(parentRouteCard);
          }
        }
      }

      if (routeCardsToRefresh.size > 0) {
        scheduleRouteUpdate(routeCardsToRefresh, DEBOUNCE_MS);
      }
    });

    uiObserver = new MutationObserver((mutations) => {
      let shouldRepositionButton = false;
      let shouldRefreshUi = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (
            target.matches?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)
            || target.closest?.('.sidebar-container')
          ) {
            shouldRepositionButton = true;
          }
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            node.matches?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)
            || node.querySelector?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)
            || node.closest?.('.sidebar-container')
          ) {
            shouldRepositionButton = true;
          }
        }

        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            node.id === SETTINGS_BUTTON_ID
            || node.id === SETTINGS_PANEL_ID
            || node.matches?.(SIDEBAR_TOGGLE_ANCHOR_SELECTOR)
            || node.querySelector?.(`#${SETTINGS_BUTTON_ID}, #${SETTINGS_PANEL_ID}, ${SIDEBAR_TOGGLE_ANCHOR_SELECTOR}`)
          ) {
            shouldRefreshUi = true;
            shouldRepositionButton = true;
          }
        }
      }

      if (shouldRefreshUi) {
        refreshExtensionUi();
      } else if (shouldRepositionButton) {
        scheduleButtonPositionUpdate(0);
      }
    });

    // Начинаем наблюдение — приоритетно на контейнере маршрутов
    const routeRoot = getRoutePanelRoot();
    routeObserver.observe(routeRoot || document.body, {
      childList: true,
      subtree: true
    });

    uiObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    });

    // Привяжем слушатели к полям адресов / кнопке построения маршрута
    attachRouteInputListeners();

    // Первоначальное обновление
    setTimeout(() => {
      updateAllRoutes();
      refreshExtensionUi();
    }, INITIAL_UPDATE_DELAY_MS);
  }

  // Запуск при загрузке страницы
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Обновление при навигации (SPA)
  let lastUrl = location.href;
  spaObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      document.querySelectorAll('.fuel-cost-display').forEach(el => el.remove());
      refreshExtensionUi();
      attachRouteInputListeners();
      scheduleUpdate(INITIAL_UPDATE_DELAY_MS);
    }
  });
  spaObserver.observe(document, { subtree: true, childList: true });

  window.addEventListener('resize', () => scheduleButtonPositionUpdate(0));

  // Очистка наблюдателей при выгрузке
  window.addEventListener('beforeunload', cleanupObservers);

})();

