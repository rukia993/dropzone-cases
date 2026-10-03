export const TARGET_RETURN_PERCENT = 65;
export function priceCase(drops, skinById, weights) {
  if (
    !drops.length ||
    drops.length !== weights.length ||
    weights.some(
      (weight, index) =>
        !Number.isSafeInteger(weight) ||
        weight <= 0 ||
        (index > 0 && weight > weights[index - 1]),
    ) ||
    new Set(drops.map((drop) => drop.skinId)).size !== drops.length ||
    weights.reduce((sum, weight) => sum + weight, 0) !== 10000
  )
    throw new Error("Некорректные вероятности кейса.");
  const ordered = drops.map((drop) => ({
    skinId: drop.skinId,
    value: skinById.get(drop.skinId)?.value,
  }));
  if (
    ordered.some((drop) => !Number.isSafeInteger(drop.value) || drop.value <= 0)
  )
    throw new Error("Для каждого предмета нужна рыночная оценка.");
  ordered.sort((a, b) => a.value - b.value || a.skinId.localeCompare(b.skinId));
  const result = ordered.map((drop, index) => ({
    skinId: drop.skinId,
    weight: weights[index],
  }));
  const weightedTotal = result.reduce(
    (sum, drop) =>
      sum + BigInt(skinById.get(drop.skinId).value) * BigInt(drop.weight),
    0n,
  );
  const divisor = BigInt(TARGET_RETURN_PERCENT * 1000);
  const units = (weightedTotal + divisor - 1n) / divisor;
  const price = Number(units * 10n);
  if (!Number.isSafeInteger(price) || price <= 0)
    throw new Error("Некорректная стоимость кейса.");
  if (ordered.at(-1).value <= price)
    throw new Error("В кейсе должен быть предмет дороже открытия.");
  return { price, drops: result };
}
