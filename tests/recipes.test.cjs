const fs = require('fs');
const assert = require('assert');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const recipeSeed = readJson('recipes.seed.json');
const productSeed = readJson('products.seed.json');
const recipes = recipeSeed.recipes;
const products = Object.fromEntries(productSeed.products.map(product => [product.id, product]));

const round = (value, digits) => {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
};

const tolerance = key => key === 'kcal' ? 1 : 0.1;
const fields = ['kcal', 'protein', 'fat', 'carbs', 'fiber'];

assert(productSeed.meta.rules.some(rule => rule.includes('тест калорийности')), 'products seed must document kcalCheck rule');

let skippedKcalChecks = 0;
for (const product of productSeed.products) {
  const check = product.kcalCheck || {};
  if (check.skip === true) {
    assert(typeof check.reason === 'string' && check.reason.trim(), `${product.id}: kcalCheck.skip requires reason`);
    skippedKcalChecks += 1;
    continue;
  }

  const n = product.per100g;
  const formulaA = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  const formulaB = 4 * n.protein + 4 * Math.max(0, n.carbs - n.fiber) + 2 * n.fiber + 9 * n.fat;
  const relativeError = Math.min(
    Math.abs(formulaA - n.kcal) / n.kcal,
    Math.abs(formulaB - n.kcal) / n.kcal,
  );
  const allowedError = Number.isFinite(check.tolerance) ? check.tolerance : 0.10;
  assert(relativeError <= allowedError, `${product.id}: kcal formula error ${(relativeError * 100).toFixed(1)}% exceeds ${(allowedError * 100).toFixed(1)}%`);
}

for (const recipe of recipes) {
  assert(Number.isInteger(recipe.servings) && recipe.servings > 0, `${recipe.id}: servings must be a positive integer`);
  assert(recipe.cookedWeightG > 0, `${recipe.id}: cookedWeightG must be positive`);

  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
  for (const ingredient of recipe.ingredients) {
    assert(products[ingredient.productId], `${recipe.id}: unknown productId ${ingredient.productId}`);
    assert(Number.isFinite(ingredient.grams) && ingredient.grams > 0, `${recipe.id}: grams must be positive`);
    const source = products[ingredient.productId].per100g;
    for (const field of fields) total[field] += source[field] * ingredient.grams / 100;
  }

  const perServing = Object.fromEntries(fields.map(field => [field, total[field] / recipe.servings]));
  const per100gCooked = Object.fromEntries(fields.map(field => [field, total[field] * 100 / recipe.cookedWeightG]));

  for (const field of fields) {
    assert(Math.abs(perServing[field] - recipe.expected.perServing[field]) <= tolerance(field), `${recipe.id}: perServing ${field} differs from expected`);
    assert(Math.abs(per100gCooked[field] - recipe.expected.per100gCooked[field]) <= tolerance(field), `${recipe.id}: per100gCooked ${field} differs from expected`);
  }
}

const recipeById = Object.fromEntries(recipes.map(recipe => [recipe.id, recipe]));
const ingredientGrams = (recipe, productId, portions) => {
  const ingredient = recipe.ingredients.find(item => item.productId === productId);
  return ingredient ? ingredient.grams * portions / recipe.servings : 0;
};

const croissant = products.prod_croissant;
const croissantRecipe = recipeById.rec_snack_croissant_cheese;
assert(croissant && croissant.pack.mode === 'per_piece', 'croissant must use per_piece packaging');
assert.strictEqual(croissant.gramsPerPiece, 60, 'croissant piece weight must be 60 g');
const croissantNeed = ingredientGrams(croissantRecipe, 'prod_croissant', 3);
assert.strictEqual(croissantNeed, 180, 'three croissant portions must need 180 g');
assert.strictEqual(Math.ceil(croissantNeed / croissant.gramsPerPiece), 3, 'three croissant portions must need 3 pieces');
assert.strictEqual(ingredientGrams(croissantRecipe, 'prod_cheese_hard', 3), 60, 'three croissant portions must need 60 g cheese before package rounding');

const lavashRecipe = recipeById.rec_main_lavash_chicken_roll;
assert.strictEqual(ingredientGrams(lavashRecipe, 'prod_lavash', 2), 200, 'two lavash rolls must need 200 g lavash before package rounding');
assert.strictEqual(ingredientGrams(lavashRecipe, 'prod_cabbage_chinese', 2), 60, 'two lavash rolls must need 60 g Chinese cabbage');

console.log(`recipes tests passed: ${recipes.length}; kcal checks skipped: ${skippedKcalChecks}`);
