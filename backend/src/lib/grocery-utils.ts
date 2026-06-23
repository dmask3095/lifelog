export type GroceryItem = {
  id: number;
  name: string;
  category: string;
  quantity: number | null;
  unit: string | null;
  storage: string;
  status: string;
  notes: string | null;
};

export function buildMealIdeas(items: GroceryItem[]) {
  const activeItems = items.filter(item => item.status !== 'finished');
  const names = activeItems.map(item => item.name.toLowerCase());
  const categories = new Set(activeItems.map(item => item.category));
  const hasName = (needle: string) => names.some(name => name.includes(needle));
  const hasCategory = (category: string) => categories.has(category);
  const ideas: Array<{ title: string; why: string; uses: string[] }> = [];

  if ((hasCategory('fruit') && hasCategory('dairy')) || (hasName('milk') && hasCategory('fruit'))) {
    ideas.push({
      title: 'Smoothie Time',
      why: 'Fruit plus dairy is basically your blender asking for screen time.',
      uses: activeItems.filter(item => item.category === 'fruit' || item.name.toLowerCase().includes('milk')).slice(0, 4).map(item => item.name),
    });
  }

  if (hasCategory('vegetable') && hasName('milk')) {
    ideas.push({
      title: 'Creamy Veggie Soup',
      why: 'Those vegetables and milk could become a cozy soup situation.',
      uses: activeItems.filter(item => item.category === 'vegetable' || item.name.toLowerCase().includes('milk')).slice(0, 5).map(item => item.name),
    });
  }

  if (hasCategory('vegetable') && (hasCategory('protein') || hasCategory('pantry'))) {
    ideas.push({
      title: 'Quick Stir-Fry Bowl',
      why: 'Veggies plus pantry or protein ingredients are one hot pan away from dinner.',
      uses: activeItems.filter(item => item.category === 'vegetable' || item.category === 'protein' || item.category === 'pantry').slice(0, 5).map(item => item.name),
    });
  }

  if (hasCategory('leftover') || activeItems.some(item => item.status === 'cooked')) {
    ideas.push({
      title: 'Leftover Remix',
      why: 'You already did the hard part. Reheat, add a side, and call it a smart win.',
      uses: activeItems.filter(item => item.category === 'leftover' || item.status === 'cooked').slice(0, 4).map(item => item.name),
    });
  }

  if (hasCategory('cake') || hasCategory('sweet')) {
    ideas.push({
      title: 'Dessert Plate',
      why: 'Cakes and sweets are not asking for permission. They are asking for tea.',
      uses: activeItems.filter(item => item.category === 'cake' || item.category === 'sweet').slice(0, 4).map(item => item.name),
    });
  }

  if (ideas.length === 0 && activeItems.length > 0) {
    ideas.push({
      title: 'Use-the-Fridge Bowl',
      why: 'You have ingredients on deck. A simple bowl, salad, saute, or snack plate would work.',
      uses: activeItems.slice(0, 5).map(item => item.name),
    });
  }

  return ideas.slice(0, 4);
}
