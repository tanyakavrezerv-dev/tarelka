const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { recipeNutrition, recipeWeight, aggregateNeeds, shoppingLines, menuCostKopecks, statusFor, weeklyStats, convertToGrams, estimateCookedWeight, consumeMenu } = require('../core/engine.cjs');
const { createStorage, DEFAULT_PREFIX } = require('../storage/local.cjs');

const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
const productsData = read('products.seed.json');
const recipesData = read('recipes.seed.json');
const pricesData = read('prices.demo.json');
const products = productsData.products;
const recipes = recipesData.recipes;

test('seed counts and references are complete', () => {
  assert.equal(products.length, 86);
  assert.equal(recipes.length, 32);
  assert.equal(pricesData.prices.length, 86);
  const productIds = new Set(products.map((product) => product.id));
  for (const recipe of recipes) for (const ingredient of recipe.ingredients) assert.ok(productIds.has(ingredient.productId), `${recipe.id}: ${ingredient.productId}`);
  for (const price of pricesData.prices) assert.ok(productIds.has(price.productId), price.productId);
});

test('demo week reproduces needs and money references', () => {
  const ids = ['rec_oatmeal_banana', 'rec_chicken_buckwheat', 'rec_omelet_tomato_cheese', 'rec_salad_fresh_veg', 'prod_blueberry'];
  const plan = ids.map((id) => id.startsWith('rec_') ? { recipeId: id, portions: 1 } : { kind: 'product', productId: id, grams: 100 });
  const needs = aggregateNeeds(plan, recipes, products);
  for (const [id, grams] of Object.entries(pricesData.expected.demoWeek.needG)) {
    assert.equal(needs.get(id) || 0, grams, `need ${id}`);
  }
  const noPantry = shoppingLines(needs, new Map(), products, pricesData.prices);
  const pantry = new Map(Object.entries(pricesData.expected.demoWeek.pantryDemo));
  const withPantry = shoppingLines(needs, pantry, products, pricesData.prices);
  assert.equal(noPantry.reduce((sum, line) => sum + line.menuKopecks, 0), pricesData.expected.demoWeek.noPantry.menuKopecks);
  assert.equal(noPantry.reduce((sum, line) => sum + line.receiptKopecks, 0), pricesData.expected.demoWeek.noPantry.receiptKopecks);
  assert.equal(withPantry.reduce((sum, line) => sum + line.receiptKopecks, 0), pricesData.expected.demoWeek.withPantry.receiptKopecks);
  assert.equal(needs.get('prod_onion'), 45);
  assert.equal(needs.get('prod_blueberry'), 100);
});

test('recipe menu costs reproduce all price references', () => {
  for (const recipe of recipes) {
    const expected = pricesData.expected.recipeMenuCost[recipe.id];
    const needs = aggregateNeeds([{ recipeId: recipe.id, portions: recipe.servings }], recipes, products);
    const total = shoppingLines(needs, new Map(), products, pricesData.prices).reduce((sum, line) => sum + line.menuKopecks, 0);
    const perServing = Math.round(total / recipe.servings);
    assert.equal(total, expected.totalKopecks, recipe.id);
    assert.equal(perServing, expected.perServingKopecks, recipe.id);
  }
});

test('recipe weight and gram nutrition use cooked weight', () => {
  const recipe = recipes.find((item) => item.id === 'rec_chicken_buckwheat');
  assert.equal(recipeWeight(recipe, 1), 250);
  assert.equal(recipeWeight(recipe, 4), 1000);
  const one = recipeNutrition(recipe, products, 1);
  const four = recipeNutrition(recipe, products, 4);
  assert.equal(Math.round(one.kcal), 336);
  assert.equal(Math.round(four.kcal), 1343);
});

test('per piece and weight products preserve their units', () => {
  const croissant = recipes.find((item) => item.id === 'rec_snack_croissant_cheese');
  const needs = aggregateNeeds([{ recipeId: croissant.id, portions: 3 }], recipes, products);
  const lines = shoppingLines(needs, new Map(), products, pricesData.prices);
  const croissantLine = lines.find((line) => line.productId === 'prod_croissant');
  assert.equal(croissantLine.needG, 180);
  assert.equal(croissantLine.units, 3);
  assert.equal(croissantLine.receiptKopecks, 18000);
  const roll = recipes.find((item) => item.id === 'rec_main_lavash_chicken_roll');
  const rollNeeds = aggregateNeeds([{ recipeId: roll.id, portions: 2 }], recipes, products);
  assert.equal(rollNeeds.get('prod_lavash'), 200);
  assert.equal(rollNeeds.get('prod_cabbage_chinese'), 60);
});

test('explicit units convert liquids and edible eggs', () => {
  const egg = products.find((p) => p.id === 'prod_egg');
  const milk = products.find((p) => p.id === 'prod_milk_25');
  assert.equal(egg.gramsPerPiece, 52);
  assert.equal(convertToGrams(egg, 2, 'pcs'), 104);
  assert.equal(convertToGrams(milk, 100, 'ml'), 103);
  const pantry = new Map([['prod_egg', 156], ['prod_milk_25', 2]]);
  const after = consumeMenu(pantry, [{ productId: 'prod_egg', amount: 2, unit: 'pcs' }, { productId: 'prod_milk_25', amount: 100, unit: 'ml' }], products);
  assert.equal(after.get('prod_egg'), 52);
  assert.equal(after.get('prod_milk_25'), 0);
});

test('dynamic cooked weight is available while explicit seed weight remains an override', () => {
  const recipe = recipes.find((item) => item.id === 'rec_chicken_buckwheat');
  assert.equal(recipeWeight(recipe, 1), 250);
  assert.ok(estimateCookedWeight(recipe, products, 1) > 0);
  assert.equal(recipeWeight(recipe, 1, estimateCookedWeight(recipe, products, recipe.servings)), estimateCookedWeight(recipe, products, 1));
});

test('target statuses use inclusive 90-110 percent range', () => {
  assert.equal(statusFor(1750, 2000), 'below');
  assert.equal(statusFor(1800, 2000), 'in_range');
  assert.equal(statusFor(2200, 2000), 'in_range');
  assert.equal(statusFor(2201, 2000), 'above');
  assert.deepEqual(weeklyStats([{ completed: true, kcal: 1800 }, { completed: true, kcal: 2200 }, { completed: false, kcal: 0 }], { kcal: 2000 }), { completed: 2, total: 3, averageKcal: 2000, averageProtein: 0, averageFat: 0, averageCarbs: 0, inRange: 2 });
});

test('storage uses the versioned prefix and falls back on broken JSON', () => {
  const data = new Map();
  const adapter = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  const storage = createStorage(adapter);
  storage.save('state', { schemaVersion: 8 });
  assert.ok(data.has(`${DEFAULT_PREFIX}state`));
  assert.deepEqual(storage.load('state'), { schemaVersion: 8 });
  data.set(`${DEFAULT_PREFIX}state`, '{broken');
  assert.equal(storage.load('state', 'seed'), 'seed');
});

