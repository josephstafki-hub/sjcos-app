// Shared normative H5 inputs. Content widths exclude outer padding, include gutter.
export const hostWidths = [
  [360, false, 0, 0, 360], [420, false, 0, 0, 420],
  [720, false, 0, 0, 720], [820, false, 0, 0, 820], [839, false, 0, 0, 839],
  [840, true, 348, 12, 480], [959, true, 402.78, 12, 544.22],
  [960, true, 403.2, 12, 544.8], [1000, true, 420, 12, 568],
  [1280, true, 537.6, 12, 730.4],
].map(([width, split, chat, gutter, pane]) => ({width, split, chat, gutter, pane}));
export const deviceCases = [
  {name:'phone', width:390, height:844, mode:'sheet', compact:true, landscape:false, stage:496},
  {name:'phone budget', width:360, height:800, mode:'sheet', compact:true, landscape:false, stage:452},
  {name:'landscape', width:800, height:360, mode:'sheet', compact:true, landscape:true, stage:204},
  {name:'iPad', width:820, height:1180, mode:'sheet', compact:false, landscape:false},
  {name:'default popout', width:1084, height:1000, mode:'popout', compact:true, landscape:false, pane:616.72},
];
export const escapeLayers = {menu:600, sheet:500, review:400, leave:300, pane:200, operator:100};
export const copy = {closeOperator:'Close Operator', back:'‹ Chat', dockBack:'Back to app', resize:'Resize Chat and pane'};
