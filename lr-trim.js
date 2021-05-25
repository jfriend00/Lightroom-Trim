const fs = require('fs');
const path = require('path');

fs.readdirSyncFull = function(dir, options) {
    let result = fs.readdirSync(dir, options);
    return result.map(f => path.join(dir, f));
}

// sanity checks to make sure we're in the right place
//   "/Lightroom/" is in the path
//   "/Backups" is in the path
//   directory we're passed contains only directory entires (no files)
//   Each candidate directory to remove has only a *.lrcat.zip file in it

const usage = `
Usage: node lr-trim.js [-p] [-d=nnn] [-n=nnn] [-m=nnn] backupParentDir
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
            switch(option) {
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

if (dirL.indexOf("lightroom") === -1 || dirL.indexOf("backups") === -1) {
    console.error("path must contain lightroom and backups");
    process.exit(1);
}

// now collect all ZIP files
let zipFiles = [];
let folders = fs.readdirSyncFull(dir);
for (folder of folders) {
    if (fs.statSync(folder).isDirectory()) {
        let files = fs.readdirSyncFull(folder).map(f => {
            let data = path.parse(f);
            data.full = f;
            return data;
        }).filter(f => {
            if (f.ext === ".zip" && fs.statSync(f.full).isFile()) {
                // parse the date out of the path since this should be more reliable than a file creation date
                let regex = new RegExp(`\\${path.sep}(\\d+)-(\\d+)-(\\d+)\\s(\\d+)$`);
                let matches = regex.exec(f.dir);
                if (matches) {
                    f.date = new Date(+matches[1], +matches[2] - 1, +matches[3]);
                    // text sort works because day, month, year are always expanded to common length so
                    // 01 sorts properly with 12
                    f.sortKey = `${matches[1]}-${matches[2]}-${matches[3]} ${matches[4]}`;
                    return true;
                } else {
                    console.error(`Found filename without proper date in parent directory ${f.dir}`);
                    return false;
                }
             
            } else {
                return false;
            }
        });
        // add zip files to the list
        zipFiles.push.apply(zipFiles, files);
    }
}

if (!zipFiles.length) {
    console.error("No Lightroom backup zip files found");
    exit(1);
}

// sort so newest are first
zipFiles.sort((a, b) => {
    return b.sortKey.localeCompare(a.sortKey);
});

if (listOnly) {
    console.log('\n');
    console.log('listOnly: ', listOnly);
    console.log('numToKeep: ', minNumToKeep);
    console.log('minDaysToKeep: ', minDaysToKeep);
    console.log('maxToRemove: ', maxToRemove);

    console.log("\nAll zip Files:");
    for (let z of zipFiles) {
        console.log("  ", z.full, z.date);
    }
}

let newestDate = zipFiles[0].date;

// keep last minNumToKeep by removing them from the zipFiles list
zipFiles.splice(0, minNumToKeep);

// keep any zips that are newer than minDaysToKeep old
let removeFiles = zipFiles.filter(f => {
    let diffDays = (newestDate - f.date) / (3600 * 1000 * 24);
    return diffDays > minDaysToKeep;
});

if (maxToRemove) {
    removeFiles = removeFiles.slice(-maxToRemove);
}

let extra = removeFiles.length === 0 ? " No backup files to trim": "";
console.log(`lr-trim: ${new Date().toDateString()}${extra}`)
if (listOnly) {
    console.log("\zip files to remove:");
    for (let z of removeFiles) {
        console.log("  ", z.full, z.date);
    }
} else {
    // get rid of the zip file
    for (let z of removeFiles) {
        try {
            console.log(`Removing: ${z.full}`);
            fs.unlinkSync(z.full);
            // now see if we can remove the parent directory
            console.log(`Removing directory: ${z.dir}`);
            fs.rmdirSync(z.dir);
        } catch(e) {
            console.error(`Error removing ${z.full} `, e)
        }
    }
}