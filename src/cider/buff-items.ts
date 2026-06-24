export const BUFF_ITEMS = [
  { name: "Onyx Apple", suggest: true, duration: 600, watt: 100, matt: 100 },
  { name: "Gelt Chocolate", suggest: true, duration: 600, watt: 120, matt: 0 },
  { name: "Heartstopper", suggest: true, duration: 60, watt: 60, matt: 0 },
  { name: "Unripe Onyx Apple", suggest: true, duration: 60, watt: 60, matt: 70 },
  { name: "Ssiws Cheese", suggest: true, duration: 120, watt: 0, matt: 220 },
  { name: "Banana Graham Pie", suggest: true, duration: 600, watt: 0, matt: 120 },
  { name: "Grandma's Pumpkin Pie", suggest: false, duration: 300, watt: 80, matt: 150 },
  { name: "Naricain's Demon Elixir", suggest: false, duration: 480, watt: 140, matt: 0 },
] as const;

export const BUFF_ITEM_NAMES = BUFF_ITEMS.map((item) => item.name);

export const SUGGESTED_BUFF_ITEM_NAMES = BUFF_ITEMS
  .filter((item) => item.suggest)
  .map((item) => item.name);
