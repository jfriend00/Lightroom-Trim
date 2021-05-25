const fs = require('fs');
const path = require('path');

fs.readdirSyncFull = function(dir, options) {
    let result = fs.readdirSync(dir, options);
    return result.map(f => path.join(dir, f));
}

// sanity checks to make sure we're in the right place
//   Directory passed has a parent that ends in .backup
//   directory we're passed contains only directory entries (no files)
//   Each candidate directory to remove has a xxx.cocatalogdb file in it

const usage = `
Usage: node capture-one-trim.js [-p] [-d=nnn] [-n=nnn] [-m=nnn] backupParentDir
    -l       list only, don't delete anything
    -d=nnn   minimum number of days of backups to keep from newest backup (default is 30)
    -n=nnn   minimum number of backups to keep (default is 10)
    -m=nnn   max files to remove each time it is called
`;

let minDaysToKeep = 30;
let minNumToKeep = 10;
let maxToRemove = 0;
let dir;
let err = false;
let listOnly = false;

for (let i = 2; i < process.argv.length; i++) {
    let arg = process.argv[i];
    if (arg.charAt(0) === "-") {
        let option = arg.charAt(1);
        if (arg.charAt(2) === '=') {
            let subArg = arg.slice(2).match(/=(\d+)$/);
            if (!subArg) {
                console.error(`Unexpected option: ${arg}`);
                err = true;
                break;
            }
            let num = +subArg[1];
            switch (option) {
                case 'd':
                    minDaysToKeep = num;
                    break;
                case 'n':
                    minNumToKeep = num;
                    break;
                case 'm':
                    maxToRemove = num;
                    break;
                default:
                    console.error(`Unexpected option: ${arg}`);
                    err = true;
                    break;
            }

        } else {
            // plain options
            if (option === 'l') {
                listOnly = true;
            }
        }
    } else {
        if (dir) {
            console.error("Encountered more than one directory");
            err = true;
            break;
        } else {
            dir = arg;
        }
    }
}

if (!dir || err) {
    console.error(usage);
    process.exit(1);
}

let dirL = dir.toLowerCase();

// safety checks for .backup in the path
if (dirL.indexOf(".backup") === -1) {
    console.error("path must contain .backup");
    process.exit(1);
}

// Now collect all directory names that contain backups
// The first level down is a catalog name
// The second level down is the actual backup directories

let catalogs = fs.readdirSyncFull(dir);

// for each catalog, build a list of backup directories
for (const catalog of catalogs) {
    const bdirs = fs.readdirSyncFull(catalog);
    // the full paths themselves will sort in date order, because of the way the directory names are constructed
    bdirs.sort();
    let backupInfo = bdirs.map(bdir => {
        // parse filename at the end of the path
        const regex = new RegExp(`\\${path.sep}(\\d+)-(\\d+)-(\\d+)\\s([\\d.]+)$`);
        const matches = regex.exec(bdir);

        // avoid any non-matching directories or non-directories
        if (!matches || !fs.statSync(bdir).isDirectory()) {
            console.log(`Ignoring non-matching file ${bdir}`);
            return null;
        }

        return {
            bdir: bdir,
            date: new Date(+matches[1], +matches[2] - 1, +matches[3]),
        }
    }).filter(item => !!item);
    if (!backupInfo.length) {
        console.error("No Capture One backup directories found");
        exit(1);
    }

    // implement minNumToKeep by removing the newest minNumToKeep from our info array
    if (minNumToKeep && backupInfo.length > minNumToKeep) {
        backupInfo.length = backupInfo.length - minNumToKeep;
    }

    // implement minDaysToKeep by filtering on the date
    if (minDaysToKeep) {
        let now = Date.now();
        let daysCutoff = now - ((minDaysToKeep + 1) * (3600 * 1000 * 24));
        backupInfo = backupInfo.filter(item => {
            // only keep it in the array if the time is before the cutoff
            return item.date.getTime() < daysCutoff;
        });
    }

    // implement maxToRemove by truncating the backupInfo array to the oldest maxToRemove
    if (maxToRemove && backupInfo.length > maxToRemove) {
        backupInfo.length = maxToRemove;
    }

    if (listOnly) {
        console.log('\n');
        console.log('listOnly: ', listOnly);
        console.log('numToKeep: ', minNumToKeep);
        console.log('minDaysToKeep: ', minDaysToKeep);
        console.log('maxToRemove: ', maxToRemove);

        if (backupInfo.length) {
            console.log("\nBackup files to be removed:");
            for (let info of backupInfo) {
                console.log(`  ${info.date}, ${info.bdir}`);
            }
        } else {
            console.log("\nNo backup files to be removed.");
        }
        process.exit(0);
    }

    let extra = backupInfo.length === 0 ? " No backup files to trim" : "";
    console.log(`capture-one-trim: ${new Date().toDateString()}${extra}`)

    // now remove the remaining directories
    for (const item of backupInfo) {
        try {
            console.log(`Removing backup directory: ${item.bdir}`);
            fs.rmSync(item.bdir, { recursive: true });
        } catch (e) {
            console.error(`Error removing ${item.bdir} `, e)
        }
    }
}