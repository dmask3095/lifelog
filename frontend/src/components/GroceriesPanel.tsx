import { useEffect, useState } from 'react';
import { api } from '../api';

interface GroceryItem {
  id: number;
  name: string;
  category: GroceryCategory;
  quantity: number | null;
  unit: string | null;
  storage: GroceryStorage;
  status: GroceryStatus;
  notes: string | null;
}

interface MealIdea {
  title: string;
  why: string;
  uses: string[];
}

interface GroceryResponse {
  items: GroceryItem[];
  mealIdeas: MealIdea[];
}

type GroceryCategory = 'dairy' | 'vegetable' | 'fruit' | 'protein' | 'pantry' | 'cake' | 'sweet' | 'leftover' | 'other';
type GroceryStorage = 'fridge' | 'freezer' | 'pantry' | 'counter' | 'unknown';
type GroceryStatus = 'stocked' | 'cook_soon' | 'eat_asap' | 'cooked' | 'finished';
type ViewMode = 'all' | 'urgent' | 'cook' | 'stored' | 'cooked' | 'ideas';

const CATEGORY_OPTIONS: Array<{ value: GroceryCategory; label: string; icon: string }> = [
  { value: 'dairy', label: 'Dairy', icon: '🥛' },
  { value: 'vegetable', label: 'Veggie', icon: '🥦' },
  { value: 'fruit', label: 'Fruit', icon: '🍎' },
  { value: 'protein', label: 'Protein', icon: '🍳' },
  { value: 'pantry', label: 'Pantry', icon: '🌾' },
  { value: 'cake', label: 'Cake', icon: '🎂' },
  { value: 'sweet', label: 'Sweet', icon: '🍬' },
  { value: 'leftover', label: 'Leftover', icon: '🍱' },
  { value: 'other', label: 'Other', icon: '📦' },
];

const STORAGE_OPTIONS: Array<{ value: GroceryStorage; label: string; icon: string }> = [
  { value: 'fridge', label: 'Fridge', icon: '🧊' },
  { value: 'freezer', label: 'Freezer', icon: '❄️' },
  { value: 'pantry', label: 'Pantry', icon: '🫙' },
  { value: 'counter', label: 'Counter', icon: '🍽' },
  { value: 'unknown', label: 'Not sure', icon: '🤷' },
];

const STATUS_OPTIONS: Array<{ value: GroceryStatus; label: string; tone: string; icon: string }> = [
  { value: 'stocked', label: 'Stocked', tone: '#7dd5ff', icon: '📦' },
  { value: 'cook_soon', label: 'Cook soon', tone: '#ffb28b', icon: '🔥' },
  { value: 'eat_asap', label: 'Eat ASAP', tone: '#ff8a82', icon: '🚨' },
  { value: 'cooked', label: 'Cooked', tone: '#84f0c2', icon: '🍲' },
  { value: 'finished', label: 'Finished', tone: '#9ca3af', icon: '✅' },
];

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string; icon: string }> = [
  { value: 'all', label: 'Everything', icon: '🧾' },
  { value: 'urgent', label: 'Eat ASAP', icon: '🚨' },
  { value: 'cook', label: 'Cook Soon', icon: '🔥' },
  { value: 'stored', label: 'In Storage', icon: '🧊' },
  { value: 'cooked', label: 'Already Cooked', icon: '🍲' },
  { value: 'ideas', label: 'What Can I Make?', icon: '🍽' },
];

const EMPTY_FORM = {
  name: '',
  category: 'vegetable' as GroceryCategory,
  quantity: '',
  unit: '',
  storage: 'fridge' as GroceryStorage,
  status: 'stocked' as GroceryStatus,
  notes: '',
};

export default function GroceriesPanel() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [mealIdeas, setMealIdeas] = useState<MealIdea[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [query, setQuery] = useState('');

  const fetchGroceries = async () => {
    setLoading(true);
    try {
      const res = await api.get<GroceryResponse>('/groceries');
      setItems(res.data.items);
      setMealIdeas(res.data.mealIdeas);
      setErrorMessage('');
    } catch {
      setErrorMessage('Groceries API is not responding yet. Restart the backend server so the new grocery routes load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroceries();
  }, []);

  const updateForm = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const updateEditForm = (field: keyof typeof EMPTY_FORM, value: string) => {
    setEditForm(current => ({ ...current, [field]: value }));
  };

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post('/groceries', {
        name: form.name.trim(),
        category: form.category,
        quantity: form.quantity === '' ? null : Number(form.quantity),
        unit: form.unit.trim() || null,
        storage: form.storage,
        status: form.status,
        notes: form.notes.trim() || null,
      });
      setForm(EMPTY_FORM);
      await fetchGroceries();
      setStatusMessage('Grocery saved to the kitchen roster.');
      setErrorMessage('');
    } catch {
      setErrorMessage('Could not save grocery item. The backend probably needs a restart to load the grocery routes.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: GroceryItem) => {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      category: item.category,
      quantity: item.quantity?.toString() ?? '',
      unit: item.unit ?? '',
      storage: item.storage,
      status: item.status,
      notes: item.notes ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const saveEdit = async () => {
    if (editingId === null || !editForm.name.trim()) return;
    try {
      await api.patch(`/groceries/${editingId}`, {
        name: editForm.name.trim(),
        category: editForm.category,
        quantity: editForm.quantity === '' ? null : Number(editForm.quantity),
        unit: editForm.unit.trim() || null,
        storage: editForm.storage,
        status: editForm.status,
        notes: editForm.notes.trim() || null,
      });
      cancelEdit();
      await fetchGroceries();
      setStatusMessage('Grocery updated.');
      setErrorMessage('');
    } catch {
      setErrorMessage('Could not update this grocery item right now.');
    }
  };

  const deleteItem = async (id: number) => {
    try {
      await api.delete(`/groceries/${id}`);
      await fetchGroceries();
      setStatusMessage('Grocery removed.');
      setErrorMessage('');
    } catch {
      setErrorMessage('Could not delete this grocery item right now.');
    }
  };

  const quickStatus = async (item: GroceryItem, status: GroceryStatus) => {
    try {
      await api.patch(`/groceries/${item.id}`, { status });
      await fetchGroceries();
      setStatusMessage(`Moved ${item.name} to ${STATUS_OPTIONS.find(option => option.value === status)?.label ?? status}.`);
      setErrorMessage('');
    } catch {
      setErrorMessage('Could not update that grocery status right now.');
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const searchedItems = items.filter(item => {
    if (!normalizedQuery) return true;
    const haystack = `${item.name} ${item.category} ${item.storage} ${item.status} ${item.notes ?? ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const urgentItems = searchedItems.filter(item => item.status === 'eat_asap');
  const cookSoonItems = searchedItems.filter(item => item.status === 'cook_soon');
  const cookedItems = searchedItems.filter(item => item.status === 'cooked' || item.category === 'leftover');
  const storedItems = searchedItems.filter(item => item.status !== 'finished');
  const storageGroups = STORAGE_OPTIONS.map(option => ({
    ...option,
    items: storedItems.filter(item => item.storage === option.value),
  }));

  const visibleSections = {
    ideas: viewMode === 'all' || viewMode === 'ideas',
    urgent: viewMode === 'all' || viewMode === 'urgent',
    cook: viewMode === 'all' || viewMode === 'cook',
    cooked: viewMode === 'all' || viewMode === 'cooked',
    stored: viewMode === 'all' || viewMode === 'stored',
  };

  const activeCount = items.filter(item => item.status !== 'finished').length;

  const renderMeta = (item: GroceryItem) => {
    const amount = item.quantity !== null && item.quantity !== undefined
      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
      : 'Qty not set';
    const storage = STORAGE_OPTIONS.find(option => option.value === item.storage);
    const status = STATUS_OPTIONS.find(option => option.value === item.status);
    const category = CATEGORY_OPTIONS.find(option => option.value === item.category);

    return (
      <div className="grocery-tags">
        <span className="grocery-tag">{category?.icon} {category?.label ?? item.category}</span>
        <span className="grocery-tag">{amount}</span>
        <span className="grocery-tag">{storage?.icon} {storage?.label ?? item.storage}</span>
        <span className="grocery-tag" style={{ color: status?.tone ?? '#dfe8f5' }}>
          {status?.icon} {status?.label ?? item.status}
        </span>
      </div>
    );
  };

  const renderEditor = () => (
    <div className="grocery-edit-grid">
      <input
        className="input"
        value={editForm.name}
        onChange={e => updateEditForm('name', e.target.value)}
        placeholder="Milk, spinach, cake..."
      />
      <div className="grocery-two-col">
        <select className="select" value={editForm.category} onChange={e => updateEditForm('category', e.target.value)}>
          {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
        </select>
        <select className="select" value={editForm.storage} onChange={e => updateEditForm('storage', e.target.value)}>
          {STORAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
        </select>
      </div>
      <div className="grocery-two-col">
        <input
          className="input"
          type="number"
          min={0}
          step="0.5"
          value={editForm.quantity}
          onChange={e => updateEditForm('quantity', e.target.value)}
          placeholder="Qty"
        />
        <input
          className="input"
          value={editForm.unit}
          onChange={e => updateEditForm('unit', e.target.value)}
          placeholder="litres, pcs, bowls..."
        />
      </div>
      <select className="select" value={editForm.status} onChange={e => updateEditForm('status', e.target.value)}>
        {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
      </select>
      <input
        className="input"
        value={editForm.notes}
        onChange={e => updateEditForm('notes', e.target.value)}
        placeholder="Opened, ripe tomorrow, frosting done..."
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-sm green" onClick={saveEdit}>Save</button>
        <button className="btn-sm" onClick={cancelEdit}>Cancel</button>
      </div>
    </div>
  );

  const renderItem = (item: GroceryItem) => {
    const isEditing = editingId === item.id;

    return (
      <div key={item.id} className="grocery-item-card">
        {isEditing ? (
          renderEditor()
        ) : (
          <>
            <div className="grocery-item-head">
              <div style={{ flex: 1 }}>
                <div className="grocery-item-title">{item.name}</div>
                {renderMeta(item)}
                {item.notes && <div className="grocery-item-note">{item.notes}</div>}
              </div>
            </div>
            <div className="grocery-actions">
              <button className="btn-sm blue" onClick={() => startEdit(item)}>Edit</button>
              <button className="btn-sm orange" onClick={() => quickStatus(item, 'cook_soon')}>Cook Soon</button>
              <button className="btn-sm red" onClick={() => quickStatus(item, 'eat_asap')}>Eat ASAP</button>
              <button className="btn-sm green" onClick={() => quickStatus(item, 'cooked')}>Cooked</button>
              <button className="btn-sm" onClick={() => quickStatus(item, 'stocked')}>Stored</button>
              <button className="btn-sm red" onClick={() => deleteItem(item.id)}>Delete</button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderSection = (title: string, subtitle: string, itemsForSection: GroceryItem[], emptyCopy: string) => (
    <div className="card">
      <div className="card-title">{title}</div>
      <p className="grocery-section-copy">{subtitle}</p>
      {itemsForSection.length === 0 ? (
        <p className="grocery-empty">{emptyCopy}</p>
      ) : (
        <div className="grocery-stack">
          {itemsForSection.map(renderItem)}
        </div>
      )}
    </div>
  );

  return (
    <div className="panel">
      <div className="card grocery-hero">
        <div className="card-title">🛒 Grocery Manager</div>
        <div className="grocery-hero-grid">
          <div>
            <h2 style={{ marginBottom: 8 }}>Kitchen dashboard</h2>
            <p className="grocery-section-copy" style={{ maxWidth: 42 + 'ch' }}>
              Track what is in the house, what needs attention, and what can become the next meal without having to mentally inventory the fridge every time.
            </p>
          </div>
          <div className="grocery-stat-grid">
            {[
              { label: 'In kitchen', value: activeCount, tone: '#9fdcff' },
              { label: 'Eat ASAP', value: urgentItems.length, tone: '#ff8a82' },
              { label: 'Cook soon', value: cookSoonItems.length, tone: '#ffbf9d' },
              { label: 'Meal ideas', value: mealIdeas.length, tone: '#98f2cb' },
            ].map(stat => (
              <div key={stat.label} className="grocery-stat-card">
                <div style={{ color: stat.tone, fontWeight: 900, fontSize: 22 }}>{stat.value}</div>
                <div className="grocery-stat-label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
        {statusMessage && (
          <div className="grocery-banner success">{statusMessage}</div>
        )}
        {errorMessage && (
          <div className="grocery-banner error">
            {errorMessage}
            <button className="btn-sm" onClick={fetchGroceries}>Retry</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">➕ Add grocery item</div>
        <div className="grocery-form-grid">
          <input
            className="input"
            value={form.name}
            onChange={e => updateForm('name', e.target.value)}
            placeholder="Milk, strawberries, cake slice, leftover curry..."
          />
          <div className="grocery-two-col">
            <select className="select" value={form.category} onChange={e => updateForm('category', e.target.value)}>
              {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
            </select>
            <select className="select" value={form.storage} onChange={e => updateForm('storage', e.target.value)}>
              {STORAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
            </select>
          </div>
          <div className="grocery-two-col">
            <input
              className="input"
              type="number"
              min={0}
              step="0.5"
              value={form.quantity}
              onChange={e => updateForm('quantity', e.target.value)}
              placeholder="Quantity"
            />
            <input
              className="input"
              value={form.unit}
              onChange={e => updateForm('unit', e.target.value)}
              placeholder="litres, pcs, bowls..."
            />
          </div>
          <select className="select" value={form.status} onChange={e => updateForm('status', e.target.value)}>
            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
          </select>
          <input
            className="input"
            value={form.notes}
            onChange={e => updateForm('notes', e.target.value)}
            placeholder="Opened today, ripe tomorrow, best with tea..."
          />
          <button onClick={handleAdd} className="btn-primary" disabled={saving || !form.name.trim()}>
            {saving ? 'Adding item...' : 'Add Grocery Item'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🧭 Browse your kitchen</div>
        <div className="grocery-toolbar">
          <input
            className="input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search milk, fruit, cake, leftovers..."
          />
          <div className="grocery-view-row">
            {VIEW_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`grocery-view-chip ${viewMode === option.value ? 'active' : ''}`}
                onClick={() => setViewMode(option.value)}
              >
                <span>{option.icon}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {visibleSections.ideas && (
        <div className="card">
          <div className="card-title">🍽 What can I cook?</div>
          <p className="grocery-section-copy">Quick ideas generated from what is currently in the kitchen.</p>
          {mealIdeas.length === 0 ? (
            <p className="grocery-empty">Add a few groceries and this section will start pitching dinner like an eager sous-chef.</p>
          ) : (
            <div className="grocery-ideas-grid">
              {mealIdeas.map(idea => (
                <div key={idea.title} className="grocery-idea-card">
                  <div className="grocery-item-title">{idea.title}</div>
                  <div className="grocery-item-note" style={{ marginTop: 6 }}>{idea.why}</div>
                  {idea.uses.length > 0 && (
                    <div className="grocery-tags" style={{ marginTop: 10 }}>
                      {idea.uses.map(use => <span key={use} className="grocery-tag">{use}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {visibleSections.urgent && renderSection(
        '🚨 Eat this first',
        'Things that should be used before they become a sad science experiment.',
        urgentItems,
        'Nothing urgent right now. Your fridge is being surprisingly cooperative.',
      )}

      {visibleSections.cook && renderSection(
        '🔥 Cook soon',
        'Ingredients that are still fine, but they are starting to raise an eyebrow.',
        cookSoonItems,
        'Nothing in the “cook soon” lane right now.',
      )}

      {visibleSections.cooked && renderSection(
        '🍲 Already cooked',
        'Leftovers, prepared dishes, and things that are one reheat away from being useful.',
        cookedItems,
        'No cooked items tracked yet.',
      )}

      {visibleSections.stored && (
        <div className="card">
          <div className="card-title">🧊 Stored inventory</div>
          <p className="grocery-section-copy">Everything that is hanging out in storage and still ready for future-you.</p>
          {loading ? (
            <p className="grocery-empty">Loading kitchen inventory...</p>
          ) : (
            <div className="grocery-storage-grid">
              {storageGroups.map(group => (
                <div key={group.value} className="grocery-storage-card">
                  <div className="grocery-storage-title">{group.icon} {group.label}</div>
                  {group.items.length === 0 ? (
                    <p className="grocery-empty" style={{ padding: '16px 0 0' }}>Nothing here yet.</p>
                  ) : (
                    <div className="grocery-stack">
                      {group.items.map(renderItem)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
