import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { buildMealIdeas, type GroceryItem } from '../lib/grocery-utils';

const router = Router();
router.use(requireAuth);

const STATUS_ORDER = `
  CASE status
    WHEN 'eat_asap' THEN 1
    WHEN 'cook_soon' THEN 2
    WHEN 'cooked' THEN 3
    WHEN 'stocked' THEN 4
    WHEN 'finished' THEN 5
    ELSE 6
  END
`;

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

router.get('/', async (req: Request, res: Response) => {
  const items = await db.all<GroceryItem>(`
    SELECT *
    FROM groceries
    WHERE user_id = ?
    ORDER BY ${STATUS_ORDER}, updated_at DESC, name COLLATE NOCASE ASC
  `, req.userId);

  res.json({
    items,
    mealIdeas: buildMealIdeas(items),
  });
});

router.post('/', async (req: Request, res: Response) => {
  const { name, category, quantity, unit, storage, status, notes } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'name and category are required' });
  }

  const result = await db.run(`
    INSERT INTO groceries (user_id, name, category, quantity, unit, storage, status, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `,
    req.userId,
    String(name).trim(),
    category,
    quantity === '' || quantity === undefined || quantity === null ? null : Number(quantity),
    unit ? String(unit).trim() : null,
    storage ?? 'fridge',
    status ?? 'stocked',
    notes ? String(notes).trim() : null,
  );

  const item = await db.get('SELECT * FROM groceries WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(item);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const existing = await db.get<GroceryItem>('SELECT * FROM groceries WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Grocery item not found' });

  const { name, category, quantity, unit, storage, status, notes } = req.body;

  await db.run(`
    UPDATE groceries
    SET
      name = COALESCE(?, name),
      category = COALESCE(?, category),
      quantity = ?,
      unit = ?,
      storage = COALESCE(?, storage),
      status = COALESCE(?, status),
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `,
    name ? String(name).trim() : null,
    category ?? null,
    quantity === undefined ? existing.quantity : (quantity === '' || quantity === null ? null : Number(quantity)),
    unit === undefined ? existing.unit : (unit ? String(unit).trim() : null),
    storage ?? null,
    status ?? null,
    notes === undefined ? existing.notes : (notes ? String(notes).trim() : null),
    req.params.id,
    req.userId,
  );

  res.json(await db.get('SELECT * FROM groceries WHERE id = ? AND user_id = ?', req.params.id, req.userId));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM groceries WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

router.get('/meta/options', async (_req: Request, res: Response) => {
  res.json({
    categories: ['dairy', 'vegetable', 'fruit', 'protein', 'pantry', 'cake', 'sweet', 'leftover', 'other'].map(value => ({
      value,
      label: titleCase(value),
    })),
    storage: ['fridge', 'freezer', 'pantry', 'counter', 'unknown'].map(value => ({
      value,
      label: titleCase(value),
    })),
    status: ['stocked', 'cook_soon', 'eat_asap', 'cooked', 'finished'].map(value => ({
      value,
      label: titleCase(value.replace('_', ' ')),
    })),
  });
});

export default router;
