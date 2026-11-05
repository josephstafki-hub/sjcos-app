import { pushActions } from "./push";
import "server-only";
import { todayActions } from "./today";
import { projectsActions } from "./projects";
import { leadsActions } from "./leads";
import { commsActions } from "./comms";
import { fieldActions } from "./field";
import { directoryActions } from "./directory";
import { operatorActions } from "./operator";

export const mobileActions = { ...pushActions, ...todayActions, ...projectsActions, ...leadsActions, ...commsActions, ...fieldActions, ...directoryActions, ...operatorActions };
