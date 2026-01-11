import { runAppleScript, escapeForAppleScript } from './applescript';

export interface AppleScriptState {
  appName: string;
  documentName?: string;
  documentContent?: string;
  selection?: string;
  additionalInfo?: Record<string, string>;
}

/**
 * App-specific AppleScript extraction scripts
 */
const APP_EXTRACTORS: Record<string, string> = {
  'Microsoft Word': `
    tell application "Microsoft Word"
      try
        set docName to name of active document
        set docContent to content of text object of active document
        set selText to content of selection
        return "doc:" & docName & "|content:" & (text 1 thru 2000 of docContent) & "|selection:" & selText
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Microsoft Excel': `
    tell application "Microsoft Excel"
      try
        set ws to name of active sheet
        set sel to address of selection
        set val to ""
        try
          set val to value of selection as text
        end try
        set wb to name of active workbook
        return "workbook:" & wb & "|sheet:" & ws & "|selection:" & sel & "|value:" & val
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Microsoft PowerPoint': `
    tell application "Microsoft PowerPoint"
      try
        set presName to name of active presentation
        set slideNum to slide index of slide of view of active window
        set slideCount to count of slides of active presentation
        return "presentation:" & presName & "|slide:" & slideNum & "/" & slideCount
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Pages': `
    tell application "Pages"
      try
        set docName to name of front document
        set bodyText to body text of front document
        return "doc:" & docName & "|content:" & (text 1 thru 2000 of bodyText)
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Numbers': `
    tell application "Numbers"
      try
        set docName to name of front document
        set sheetName to name of active sheet of front document
        return "doc:" & docName & "|sheet:" & sheetName
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Keynote': `
    tell application "Keynote"
      try
        set docName to name of front document
        set slideNum to slide number of current slide of front document
        set slideCount to count of slides of front document
        return "doc:" & docName & "|slide:" & slideNum & "/" & slideCount
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Notes': `
    tell application "Notes"
      try
        set noteBody to body of selection
        set noteName to name of selection
        return "note:" & noteName & "|content:" & (text 1 thru 2000 of noteBody)
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'TextEdit': `
    tell application "TextEdit"
      try
        set docName to name of front document
        set docText to text of front document
        return "doc:" & docName & "|content:" & (text 1 thru 2000 of docText)
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Finder': `
    tell application "Finder"
      try
        set selectedItems to selection
        set selNames to ""
        repeat with i in selectedItems
          set selNames to selNames & name of i & ", "
        end repeat
        set currentFolder to name of front Finder window
        set folderPath to POSIX path of (target of front Finder window as alias)
        return "folder:" & currentFolder & "|path:" & folderPath & "|selected:" & selNames
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
  
  'Terminal': `
    tell application "Terminal"
      try
        set termContent to contents of selected tab of front window
        set lastLines to ""
        set lineList to paragraphs of termContent
        set lineCount to count of lineList
        set startLine to lineCount - 20
        if startLine < 1 then set startLine to 1
        repeat with i from startLine to lineCount
          set lastLines to lastLines & item i of lineList & "\\n"
        end repeat
        return "terminal:" & lastLines
      on error errMsg
        return "error:" & errMsg
      end try
    end tell
  `,
};

/**
 * Check if an app has an AppleScript dictionary
 */
export async function hasAppleScriptDictionary(appName: string): Promise<boolean> {
  // First check if we have a predefined extractor
  if (APP_EXTRACTORS[appName]) {
    return true;
  }
  
  // Check if app has sdef
  try {
    const result = await runAppleScript(`
      try
        set appPath to POSIX path of (path to application "${escapeForAppleScript(appName)}")
        do shell script "sdef '" & appPath & "' 2>/dev/null | head -c 100"
        return "true"
      on error
        return "false"
      end try
    `);
    return result === 'true';
  } catch {
    return false;
  }
}

/**
 * Extract state from an app using AppleScript
 */
export async function extractViaAppleScript(appName: string): Promise<AppleScriptState | null> {
  const extractor = APP_EXTRACTORS[appName];
  
  if (!extractor) {
    return null;
  }
  
  try {
    const result = await runAppleScript(extractor);
    return parseAppleScriptResult(appName, result);
  } catch (error) {
    console.error(`AppleScript extraction failed for ${appName}:`, error);
    return null;
  }
}

/**
 * Parse AppleScript extraction result
 */
function parseAppleScriptResult(appName: string, result: string): AppleScriptState | null {
  if (result.startsWith('error:')) {
    console.error(`AppleScript error for ${appName}:`, result);
    return null;
  }
  
  const state: AppleScriptState = {
    appName,
    additionalInfo: {},
  };
  
  // Parse pipe-separated key:value pairs
  const pairs = result.split('|');
  pairs.forEach((pair) => {
    const colonIndex = pair.indexOf(':');
    if (colonIndex > 0) {
      const key = pair.slice(0, colonIndex).trim();
      const value = pair.slice(colonIndex + 1).trim();
      
      switch (key) {
        case 'doc':
        case 'workbook':
        case 'presentation':
        case 'note':
          state.documentName = value;
          break;
        case 'content':
          state.documentContent = value;
          break;
        case 'selection':
        case 'selected':
          state.selection = value;
          break;
        default:
          if (state.additionalInfo) {
            state.additionalInfo[key] = value;
          }
      }
    }
  });
  
  return state;
}

/**
 * Format AppleScript state for agent context
 */
export function formatAppleScriptState(state: AppleScriptState): string {
  const lines: string[] = [];
  
  lines.push(`App: ${state.appName}`);
  
  if (state.documentName) {
    lines.push(`Document: ${state.documentName}`);
  }
  
  if (state.selection) {
    lines.push(`Selection: "${state.selection.slice(0, 200)}"`);
  }
  
  if (state.additionalInfo) {
    Object.entries(state.additionalInfo).forEach(([key, value]) => {
      lines.push(`${key}: ${value}`);
    });
  }
  
  if (state.documentContent) {
    lines.push('');
    lines.push('Content:');
    lines.push(state.documentContent.slice(0, 1000));
  }
  
  return lines.join('\n');
}

