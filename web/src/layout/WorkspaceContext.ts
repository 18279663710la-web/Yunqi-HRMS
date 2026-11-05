import { createContext, useContext } from 'react';

export const WorkspaceActiveContext = createContext(true);
export const useWorkspaceActive = () => useContext(WorkspaceActiveContext);
