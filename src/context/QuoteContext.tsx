import React, { createContext, useContext, ReactNode } from 'react';
import { Quote, Part, Customer, Material } from '../types';
import { mockCustomers } from '../data/mockCustomers';
import { mockMaterials } from '../data/mockMaterials';
import { usePersistentState } from '../hooks/usePersistentState';

interface QuoteContextType {
  quotes: Quote[];
  parts: Part[];
  customers: Customer[];
  materials: Material[];
  addQuote: (quote: Quote) => void;
  updateQuote: (quote: Quote) => void;
  deleteQuote: (id: string) => void;
  getQuoteById: (id: string) => Quote | undefined;
  getPartById: (id: string) => Part | undefined;
  getCustomerById: (id: string) => Customer | undefined;
  getMaterialById: (id: string) => Material | undefined;
  addMaterial: (material: Material) => void;
  updateMaterial: (material: Material) => void;
  deleteMaterial: (id: string) => void;
  addPart: (part: Part) => void;
}

const QuoteContext = createContext<QuoteContextType | undefined>(undefined);

export const QuoteProvider = ({ children }: { children: ReactNode }) => {
  // Quotes and parts start empty — they are created through the quoting wizard.
  // Keys are bumped so any previously-seeded demo records clear on next load.
  const [quotes, setQuotes] = usePersistentState<Quote[]>('quotes_v2', []);
  const [parts, setParts] = usePersistentState<Part[]>('parts_v2', []);
  const [customers, setCustomers] = usePersistentState<Customer[]>('customers_v2', mockCustomers);
  // Key bumped to re-seed the machining-stock library over the old sheet-metal one
  // held in localStorage (prices are still editable in Materials afterwards).
  const [materials, setMaterials] = usePersistentState<Material[]>('materials_cnc_v1', mockMaterials);

  const addQuote = (quote: Quote) => setQuotes([quote, ...quotes]);
  
  const updateQuote = (updatedQuote: Quote) => {
    setQuotes(quotes.map(q => q.id === updatedQuote.id ? updatedQuote : q));
  };

  const deleteQuote = (id: string) => setQuotes(quotes.filter(q => q.id !== id));

  const getQuoteById = (id: string) => quotes.find(q => q.id === id);
  const getPartById = (id: string) => parts.find(p => p.id === id);
  const getCustomerById = (id: string) => customers.find(c => c.id === id);
  const getMaterialById = (id: string) => materials.find(m => m.id === id);

  const addMaterial = (material: Material) => setMaterials([material, ...materials]);

  const updateMaterial = (updated: Material) => {
    setMaterials(materials.map(m => m.id === updated.id ? updated : m));
  };

  const deleteMaterial = (id: string) => setMaterials(materials.filter(m => m.id !== id));

  const addPart = (part: Part) => setParts([part, ...parts]);

  return (
    <QuoteContext.Provider value={{ 
      quotes, 
      parts, 
      customers, 
      materials, 
      addQuote, 
      updateQuote, 
      deleteQuote,
      getQuoteById,
      getPartById,
      getCustomerById,
      getMaterialById,
      addMaterial,
      updateMaterial,
      deleteMaterial,
      addPart
    }}>
      {children}
    </QuoteContext.Provider>
  );
};

export const useQuotes = () => {
  const context = useContext(QuoteContext);
  if (!context) throw new Error('useQuotes must be used within a QuoteProvider');
  return context;
};
