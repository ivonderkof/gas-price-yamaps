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
  } = globalThis.FuelCalcCore;

  // Настройки по умолчанию
  const DEFAULT_FUEL_PRICE = 50; // руб/литр
  const DEFAULT_FUEL_CONSUMPTION = 8; // литров на 100 км

  // Состояние
  let fuelPrice = DEFAULT_FUEL_PRICE;
  let fuelConsumption = DEFAULT_FUEL_CONSUMPTION;
  let settingsPanel = null;
  let observer = null;
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
  const ROUTE_INPUT_KEYWORDS = ['откуда', 'куда'];
  const BUILD_ROUTE_TEXT = 'построить маршрут';
  const detailedRouteContainerSelector = DOM_RULES.detailedRouteContainers.join(',');
  const detailedRouteChildSelector = DOM_RULES.detailedRouteChildren.join(',');

  const DEBOUNCE_MS = 500;
  const INPUT_DEBOUNCE_MS = 800;
  const INITIAL_UPDATE_DELAY_MS = 1000;

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

    if (node.matches?.('[class*="route-snippet"]') || node.closest?.('[class*="route-snippet"]')) {
      return true;
    }

    return routeText.includes('мин') || routeText.includes('ч');
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
      <span class="fuel-cost-icon">⛽</span>
      <span class="fuel-cost-text">${formatCost(cost)}</span>
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

  // Создание панели настроек
  function createSettingsPanel() {
    if (settingsPanel) return settingsPanel;

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

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = createSettingsPanel();
      // Переключаем видимость панели
      if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
      } else {
        panel.style.display = 'none';
      }
    });

    document.body.appendChild(button);
  }

  function cleanupObservers() {
    if (observer) {
      observer.disconnect();
      observer = null;
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
    
    // Создаем панель настроек сначала
    createSettingsPanel();
    
    // Создаем кнопку
    createSettingsButton();
    
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
    } else {
      // Если кнопка не создалась, пробуем еще раз через небольшую задержку
      setTimeout(() => {
        createSettingsButton();
      }, DEBOUNCE_MS);
    }

    // Наблюдаем за изменениями DOM
    observer = new MutationObserver((mutations) => {
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

      if (!document.getElementById(SETTINGS_BUTTON_ID)) {
        createSettingsButton();
      }
    });

    // Начинаем наблюдение — приоритетно на контейнере маршрутов
    const routeRoot = getRoutePanelRoot();
    const targetNode = routeRoot || document.body;
    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });

    // Привяжем слушатели к полям адресов / кнопке построения маршрута
    attachRouteInputListeners();

    // Первоначальное обновление
    setTimeout(() => {
      updateAllRoutes();
      // Убеждаемся, что кнопка создана
      if (!document.getElementById(SETTINGS_BUTTON_ID)) {
        createSettingsButton();
      }
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
      scheduleUpdate(INITIAL_UPDATE_DELAY_MS);

      if (!document.getElementById(SETTINGS_BUTTON_ID)) {
        createSettingsButton();
      }
      if (!document.getElementById(SETTINGS_PANEL_ID)) {
        createSettingsPanel();
      }
      attachRouteInputListeners();
    }
  });
  spaObserver.observe(document, { subtree: true, childList: true });

  // Очистка наблюдателей при выгрузке
  window.addEventListener('beforeunload', cleanupObservers);

})();

