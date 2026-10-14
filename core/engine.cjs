const round = (value) => Math.round(value);

function convertToGrams(product, amount, unit = product.baseUnit || 'g') {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('Amount must be a non-negative number');
  if (unit === 'g') return value;
  if (unit === 'ml') {
    if (!product.densityGPerMl) throw new Error(`Product ${product.id} has no densityGPerMl`);
    return value * product.densityGPerMl;
  }
  if (unit === 'pcs') {
    if (!product.gramsPerPiece) throw new Error(`Product ${product.id} has no gramsPerPiece`);
    return value * product.gramsPerPiece;
  }
  throw new Error(`Unknown unit: ${unit}`);
}

function ingredientGrams(ingredient, product) {
  if (ingredient.grams != null) return Number(ingredient.grams);
  const unit = ingredient.unit || product.baseUnit || 'g';
  return convertToGrams(product, ingredient.amount, unit);
}

function productIndex(products) {
  return new Map(products.map((product) => [product.id, product]));
}

function recipeIndex(recipes) {
  return new Map(recipes.map((recipe) => [recipe.id, recipe]));
}

function recipeNutrition(recipe, products, portions = 1) {
  const byId = productIndex(products);
  const factor = portions / recipe.servings;
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
  for (const ingredient of recipe.ingredients) {
    const product = byId.get(ingredient.productId);
    if (!product) throw new Error(`Unknown productId: ${ingredient.productId}`);
    const grams = ingredientGrams(ingredient, product) * factor;
    for (const key of Object.keys(total)) total[key] += grams * (product.per100g[key] || 0) / 100;
  }
  return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, round(value * 10) / 10]));
}

function recipeWeight(recipe, portions = 1, cookedWeightG = null, products = null, options = {}) {
  let cooked = cookedWeightG;
  if (cooked == null && products && recipe.cookedWeightSource === 'estimate') cooked = estimateCookedWeight(recipe, products, recipe.servings, options);
  if (cooked == null) cooked = recipe.cookedWeightG;
  return cooked * portions / recipe.servings;
}

function estimateCookedWeight(recipe, products, portions = 1, options = {}) {
  const byId = productIndex(products);
  const factor = portions / recipe.servings;
  const yieldByState = { meat: 0.75, fish: 0.78, vegetables: 0.9 };
  const grainYield = { buckwheat: 2.5, rice: 2.7, pasta: 2.3, lentil: 2.5, beans: 2.3 };
  let weight = 0;
  for (const ingredient of recipe.ingredients) {
    const product = byId.get(ingredient.productId);
    if (!product) throw new Error(`Unknown productId: ${ingredient.productId}`);
    const grams = ingredientGrams(ingredient, product) * factor;
    const key = `${String(product.id || '').toLowerCase()} ${String(product.name || '').toLowerCase()}`;
    const state = String(product.state || '').toLowerCase();
    let coefficient = 1;
    const grain = Object.keys(grainYield).find((name) => key.includes(name));
    if (grain) coefficient = grainYield[grain];
    else if (yieldByState[state]) coefficient = yieldByState[state];
    else if (String(product.category || '').toLowerCase() === 'vegetables') coefficient = 0.9;
    weight += grams * coefficient;
  }
  const waterMl = Number(recipe.addedWaterMl || 0) * factor;
  weight += waterMl * Number(options.waterRetention ?? 0.85);
  return round(weight * 10) / 10;
}

function recipePer100g(recipe, products, portions = 1, cookedWeightG = null, options = {}) {
  const nutrition = recipeNutrition(recipe, products, portions);
  const weight = recipeWeight(recipe, portions, cookedWeightG, products, options);
  return Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, round(value / weight * 100 * 10) / 10]));
}

function aggregateNeeds(planEntries, recipes, products) {
  const byRecipe = recipeIndex(recipes);
  const byId = productIndex(products);
  const needs = new Map();
  for (const entry of planEntries) {
    if (!entry || entry.kind === 'product') {
      if (entry && entry.productId) needs.set(entry.productId, (needs.get(entry.productId) || 0) + Number(entry.grams || 0));
      continue;
    }
    const recipe = byRecipe.get(entry.recipeId);
    if (!recipe) throw new Error(`Unknown recipeId: ${entry.recipeId}`);
    const factor = Number(entry.portions || 1) / recipe.servings;
    for (const ingredient of recipe.ingredients) {
      const product = byId.get(ingredient.productId);
      if (!product) throw new Error(`Unknown productId: ${ingredient.productId}`);
      needs.set(ingredient.productId, (needs.get(ingredient.productId) || 0) + ingredientGrams(ingredient, product) * factor);
    }
  }
  return new Map([...needs].map(([id, grams]) => [id, round(grams)]));
}

function priceFor(productId, prices) {
  const row = prices.find((item) => item.productId === productId);
  if (!row) throw new Error(`No price for productId: ${productId}`);
  return row;
}

function menuCostKopecks(needG, product, price) {
  if (price.model === 'fixed') return round(needG * price.priceKopecks / price.packSizeG);
  if (price.model === 'weight') return round(needG * price.priceKopecksPerKg / 1000);
  if (price.model === 'per_piece') return round(needG / price.gramsPerPiece * price.priceKopecks);
  throw new Error(`Unknown price model: ${price.model}`);
}

function receiptUnits(toCoverG, product, price) {
  if (price.model === 'fixed') return Math.ceil(toCoverG / price.packSizeG);
  if (price.model === 'weight') return toCoverG / 1000;
  if (price.model === 'per_piece') return Math.ceil(toCoverG / price.gramsPerPiece);
  throw new Error(`Unknown price model: ${price.model}`);
}

function receiptCostKopecks(toCoverG, product, price) {
  if (toCoverG <= 0) return 0;
  if (price.model === 'fixed') return receiptUnits(toCoverG, product, price) * price.priceKopecks;
  if (price.model === 'weight') return round(toCoverG * price.priceKopecksPerKg / 1000);
  if (price.model === 'per_piece') return receiptUnits(toCoverG, product, price) * price.priceKopecks;
  throw new Error(`Unknown price model: ${price.model}`);
}

function shoppingLines(needs, pantry, products, prices) {
  const byId = productIndex(products);
  const lines = [];
  for (const [productId, rawNeed] of needs) {
    const product = byId.get(productId);
    if (!product) throw new Error(`Unknown productId: ${productId}`);
    const needG = round(rawNeed);
    const haveG = Math.max(0, Number(pantry.get(productId) || pantry[productId] || 0));
    const toCoverG = Math.max(0, needG - haveG);
    const price = priceFor(productId, prices);
    lines.push({ productId, needG, haveG, toCoverG, menuKopecks: menuCostKopecks(needG, product, price), receiptKopecks: receiptCostKopecks(toCoverG, product, price), units: receiptUnits(toCoverG, product, price), price });
  }
  return lines;
}

function statusFor(actual, target) {
  if (!target || target <= 0) return 'neutral';
  const ratio = actual / target;
  if (ratio < 0.9) return 'below';
  if (ratio <= 1.1) return 'in_range';
  return 'above';
}

function weeklyStats(days, target) {
  const completed = days.filter((day) => day.completed);
  const average = (key) => completed.length ? completed.reduce((sum, day) => sum + Number(day[key] || 0), 0) / completed.length : 0;
  return { completed: completed.length, total: days.length, averageKcal: average('kcal'), averageProtein: average('protein'), averageFat: average('fat'), averageCarbs: average('carbs'), inRange: completed.filter((day) => statusFor(day.kcal, target.kcal) === 'in_range').length };
}

function consumeMenu(pantry, consumedItems, products, microThreshold = 5) {
  const next = pantry instanceof Map ? new Map(pantry) : { ...pantry };
  const get = (id) => Number(next instanceof Map ? next.get(id) || 0 : next[id] || 0);
  const set = (id, value) => {
    const cleaned = Math.abs(value) < microThreshold ? 0 : Math.max(0, value);
    if (next instanceof Map) next.set(id, cleaned); else next[id] = cleaned;
  };
  for (const item of consumedItems) {
    const product = productIndex(products).get(item.productId);
    if (!product) throw new Error(`Unknown productId: ${item.productId}`);
    const grams = ingredientGrams({ amount: item.amount ?? item.grams ?? 0, unit: item.unit || 'g' }, product);
    set(item.productId, get(item.productId) - grams);
  }
  return next;
}

module.exports = { productIndex, recipeIndex, convertToGrams, ingredientGrams, recipeNutrition, recipeWeight, estimateCookedWeight, recipePer100g, aggregateNeeds, menuCostKopecks, receiptCostKopecks, shoppingLines, consumeMenu, statusFor, weeklyStats };
