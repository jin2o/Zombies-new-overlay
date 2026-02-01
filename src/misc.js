var colors = {
  "0": { color: "black" },
  "1": { color: "dark_blue" },
  "2": { color: "dark_green" },
  "3": { color: "dark_aqua" },
  "4": { color: "dark_red" },
  "5": { color: "dark_purple" },
  "6": { color: "gold" },
  "7": { color: "gray" },
  "8": { color: "dark_gray" },
  "9": { color: "blue" },
  a: { color: "green" },
  b: { color: "aqua" },
  c: { color: "red" },
  d: { color: "light_purple" },
  e: { color: "yellow" },
  f: { color: "white" },
}

const getRank = json => {
  let rank = 'NON';
  
  // Check if we have a valid player object
  if (!json || typeof json !== 'object') {
    console.log('getRank: Invalid JSON input');
    return rank;
  }

  // Modern Hypixel API structure - check player object first
  const playerData = json.player || json;
  
  // Log the player data structure to see what fields are available
  console.log('getRank: Player data fields:', Object.keys(playerData));
  
  // First check for monthly package rank (MVP++) - only if it's SUPERSTAR
  if (playerData.monthlyPackageRank === "SUPERSTAR") {
    console.log('getRank: monthlyPackageRank found (MVP++):', playerData.monthlyPackageRank);
    rank = "MVP++";
  }
  // Then check for new package rank (modern ranks)
  else if (playerData.newPackageRank) {
    console.log('getRank: newPackageRank found:', playerData.newPackageRank);
    rank = replaceRank(playerData.newPackageRank);
  }
  // Then check for legacy package rank
  else if (playerData.packageRank) {
    console.log('getRank: packageRank found:', playerData.packageRank);
    rank = replaceRank(playerData.packageRank);
  }
  // Check if monthlyPackageRank exists but isn't SUPERSTAR (should be ignored)
  else if (playerData.monthlyPackageRank) {
    console.log('getRank: monthlyPackageRank found (non-SUPERSTAR):', playerData.monthlyPackageRank);
    // Ignore monthlyPackageRank if it's not SUPERSTAR, as it's likely "NONE"
  }
  
  // Check for staff ranks
  if (playerData.rank && playerData.rank !== 'NORMAL') {
    console.log('getRank: staff rank found:', playerData.rank);
    rank = playerData.rank.replace('MODERATOR', 'MOD');
  }
  
  // Check for prefix (formatted rank)
  if (playerData.prefix) {
    console.log('getRank: prefix found:', playerData.prefix);
    const cleanPrefix = playerData.prefix.replace(/§.|\[|]/g, '');
    if (cleanPrefix && cleanPrefix !== '') {
      rank = cleanPrefix;
    }
  }
  
  // Handle YouTube rank
  if (rank === "YOUTUBER") rank = "YOUTUBE";
  
  // Handle empty rank
  if (rank === '' || rank === 'NONE') rank = 'NON';

  function replaceRank(toReplace) {
    if (!toReplace) return 'NON';
    console.log('getRank: replaceRank input:', toReplace);
    const result = toReplace
      .replace('SUPERSTAR', "MVP++")
      .replace('VIP_PLUS', 'VIP+')
      .replace('MVP_PLUS', 'MVP+')
      .replace('NONE', 'NON');
    console.log('getRank: replaceRank result:', result);
    return result;
  }

  console.log('getRank: Final rank:', rank);
  return rank;
}

const getPlusColor = (rank, plusColor) => {
  console.log(`getPlusColor called with rank: ${rank}, plusColor: ${plusColor}`);
  // If no plusColor is provided, use default colors based on rank
  if (plusColor == undefined || plusColor == null || rank == 'PIG+++') {
    var rankColor = {
      'MVP+': { mc: '§c', hex: '#FF5555' },
      'MVP++': { mc: '§6', hex: '#FFAA00' },
      'VIP+': { mc: '§6', hex: '#FFAA00' },
      'PIG+++': { mc: '§b', hex: '#FF55FF' },
    }[rank]
    if (!rankColor) {
      console.log(`No default color found for rank ${rank}, returning gray`);
      return { mc: '§7', hex: '#BAB6B6' }
    }
    console.log(`Returning default color for rank ${rank}:`, rankColor);
    return rankColor;
  } else {
    // Convert the plus color from Hypixel API format to our format (case-insensitive)
    // Create a case-insensitive mapping
    const colorMap = {
      'RED': { mc: '§c', hex: '#FF5555' },
      'GOLD': { mc: '§6', hex: '#FFAA00' },
      'GREEN': { mc: '§a', hex: '#55FF55' },
      'YELLOW': { mc: '§e', hex: '#FFFF55' },
      'LIGHT_PURPLE': { mc: '§d', hex: '#FF55FF' },
      'WHITE': { mc: '§f', hex: '#F2F2F2' },
      'BLUE': { mc: '§9', hex: '#5555FF' },
      'DARK_GREEN': { mc: '§2', hex: '#00AA00' },
      'DARK_RED': { mc: '§4', hex: '#AA0000' },
      'DARK_AQUA': { mc: '§3', hex: '#00AAAA' },
      'DARK_PURPLE': { mc: '§5', hex: '#AA00AA' },
      'DARK_GRAY': { mc: '§8', hex: '#555555' },
      'DARK_BLUE': { mc: '§1', hex: '#0000AA' },
      'GRAY': { mc: '§7', hex: '#AAAAAA' },
      'AQUA': { mc: '§b', hex: '#55FFFF' },
      'BLACK': { mc: '§0', hex: '#000000' }
    };
    
    // Find the color mapping in a case-insensitive way
    let rankColorMC = null;
    if (typeof plusColor === 'string') {
      const upperPlusColor = plusColor.toUpperCase();
      rankColorMC = colorMap[upperPlusColor];
    }
    
    if (!rankColorMC) {
      console.log(`No color mapping found for plusColor ${plusColor}, returning gray`);
      return { mc: '§7', hex: '#BAB6B6' }
    }
    console.log(`Returning mapped color for plusColor ${plusColor}:`, rankColorMC);
    return rankColorMC;
  }
}

const getFormattedRank = (rank, color, monthlyRankColor) => {
  // Extract just the color code from the full color string (removing the § symbol)
  const colorCode = color && color.startsWith('§') ? color.substring(1) : color || '7';
  const monthlyColorCode = monthlyRankColor && monthlyRankColor.startsWith('§') ? monthlyRankColor.substring(1) : monthlyRankColor || '6'; // Default to gold for monthly rank color
  
  // For MVP++, we use the monthly rank color for the "MVP" part and the plus color for the "++" part
  if (rank === 'MVP++') {
    rank = `§${monthlyColorCode}[MVP§${colorCode}++§${monthlyColorCode}]`;
  } else {
    rank = { 'MVP+': `§b[MVP§${colorCode}+§b]`, 'MVP': '§b[MVP]', 'VIP+': `§a[VIP§${colorCode}+§a]`, 'VIP': `§a[VIP]`, 'YOUTUBE': `§c[§fYOUTUBE§c]`, 'PIG+++': `§d[PIG§${colorCode}+++§d]`, 'HELPER': `§9[HELPER]`, 'MOD': `§2[MOD]`, 'ADMIN': `§c[ADMIN]`, 'OWNER': `§c[OWNER]`, 'SLOTH': `§c[SLOTH]`, 'ANGUS': `§c[ANGUS]`, 'APPLE': '§6[APPLE]', 'MOJANG': `§6[MOJANG]`, 'BUILD TEAM': `§3[BUILD TEAM]`, 'EVENTS': `§6[EVENTS]` }[rank];
  }
  
  if (!rank) return `§7`;
  return `${rank} `;
}

const getRankColor = (rank) => {
  if (["YOUTUBE", "ADMIN", "OWNER", "SLOTH"].includes(rank)) return "c";
  else if (rank == "PIG+++") return "d";
  else if (rank == "MOD") return "2";
  else if (rank == "HELPER") return "9";
  else if (rank == "BUILD TEAM") return "3";
  else if (["MVP++", "APPLE", "MOJANG"].includes(rank)) return "6";
  else if (["MVP+", "MVP"].includes(rank)) return "b";
  else if (["VIP+", "VIP"].includes(rank)) return "a";
  else return "7";
}

const ratio = (n1 = 0, n2 = 0) => isFinite(n1 / n2) ? + (n1 / n2).toFixed(2) : isFinite(n2) ? 0 : Infinity

const mcColorParser = text => {
  var splitText = text.split("§").slice(1)
  var finalText = ""

  splitText.forEach(parts => finalText += `<span class="${colors[parts[0]].color} shadow">${parts.split("").slice(1).join("")}</span>`)
  return finalText
}

module.exports = {
  getRank,
  getPlusColor,
  getRankColor,
  getFormattedRank,
  ratio,
  mcColorParser
}