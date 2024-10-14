async function findTexturesFor(blockType, variant = {}) {
    const blockVariant = await fetch(`../minecraft/blockstates/${blockType}.json`)
        .then(res => res.json())
        .catch(reason => console.error(reason));

    if (blockVariant) {
        if ("multipart" in blockVariant) { // Handle multipart blocks
            let parts = [];

            for (let entry of blockVariant.multipart) {
                if (!("when" in entry)) {
                    parts.push(processModel(entry.apply));
                } else if ("OR" in entry.when) {
                    for (const option of entry.when.OR) {
                        let matches = true;

                        for (const state of Object.keys(option)) {
                            if (!option[state].split("|").includes(variant[state])) {
                                matches = false;
                                break;
                            }
                        }

                        if (matches) {
                            parts.push(processModel(entry.apply));
                            break;
                        }
                    }
                } else if ("AND" in entry.when) {
                    let allMatch = true;

                    for (const option of entry.when.AND) {
                        let matches = true;

                        for (const state of Object.keys(option)) {
                            if (!option[state].split("|").includes(variant[state])) {
                                matches = false;
                                break;
                            }
                        }

                        if (!matches) {
                            allMatch = false;
                            break;
                        }
                    }

                    if (allMatch) {
                        parts.push(processModel(entry.apply));
                    }
                } else {
                    let matches = true;

                    for (const state of Object.keys(entry.when)) {
                        if (!entry.when[state].split("|").includes(variant[state])) {
                            matches = false;
                            break;
                        }
                    }

                    if (matches) {
                        parts.push(processModel(entry.apply));
                    }
                }
            }

            return await Promise.all(parts);
        }
        else if ("variants" in blockVariant) { // Handle singluar blocks
            if ("" in blockVariant.variants && Object.keys(variant).length === 0) {
                return await processModel(blockVariant.variants[""]);
            }

            for (const variantKey of Object.keys(blockVariant.variants)) {
                let reject = false;
                for (const categoryEntry of variantKey.split(",")) {
                    const [category, value] = categoryEntry.split("=");
                    if (!(category in variant) || value !== variant[category]) {
                        reject = true;
                        break;
                    }
                }

                if (!reject) {
                    return await processModel(blockVariant.variants[variantKey]);
                }
            }
        }

        console.error(`Failed to find blockstate file with name ${blockType}`);
        return null;
    }
}

async function processModel(modelData) {
    if (Array.isArray(modelData)) { // Handle blocks with randomly selected textures
        let calc = [];
        let weights = [];

        for (let entry of modelData) {
            calc.push(retrieveBlockData(entry.model, entry.x ?? 0, entry.y ?? 0, entry.uvlock ?? false));
            weights.push(entry.weight ?? 1);
        }

        calc = await Promise.all(calc);
        return calc.map((v, i) => ({ value: v, weight: weights[i] }));
    }
    else { // Handle boring simple blocks
        return await retrieveBlockData(modelData.model, modelData.x ?? 0, modelData.y ?? 0, modelData.uvlock ?? false);
    }
}

async function retrieveBlockData(modelPath, xRot, yRot, uvlocked) {
    // For some reason, only some texture files start with this (even though they all should)
    modelPath = modelPath.replace(/^[^:]+:block\//, "");

    const modelDefinition = await fetch(`../minecraft/models/block/${modelPath}.json`)
        .then(res => res.json())
        .catch(reason => console.error(reason));

    if (modelDefinition) {
        // TODO: Append xRot, yRot, uvlock
        const modelData = {
            model: await defineBlockModel(modelDefinition),
            xRot: xRot,
            yRot: yRot,
            uvlocked: uvlocked
        };

        cleanModelTextureLinks(modelData.model.textures);
        return modelData;
    }

    console.error(`Failed to recognize block data! attempting to read block model from file ${modelPath}`);
    return null;
}

async function defineBlockModel(modelDefinition) {
    // Not dealing with ambient occlusion & shadows because it's too build-dependent, and unlike blockstates, there is no way to manually set how a block should be rendered with AO.
    // display is for custom rendering when a block is in item form. Doesn't matter except for potentially handling item frame rendering

    let baseModel = {};

    if ("parent" in modelDefinition) { // Children models modify parent, so first initialize as parent
        // Implicitly assumes that files are in ../minecraft/models/block/ . Sorry, no mod support!
        if (modelDefinition.parent.match("builtin/[.*]")) {
            // TODO
            console.error("block model uses (hardcoded) entity rendering, not yet supported!");
            return null;
        }

        const parentModel = await fetch(`../minecraft/models/block/${modelDefinition.parent.split("/").pop()}.json`)
            .then(res => res.json())
            .catch(reason => console.error(reason));

        baseModel = await defineBlockModel(parentModel);
    }

    if ("textures" in modelDefinition) {
        if (!("textures" in baseModel)) {
            baseModel.textures = {};
        }

        for (let textureName of Object.keys(modelDefinition.textures)) {
            if (textureName === "particle") { // Used to define particle to use when breaking blocks, which is irrelevant. Does matter for lava and water blocks though.
                // TODO
                continue;
            }

            let textureJSON;
            if (modelDefinition.textures[textureName].startsWith("#")) {
                textureJSON = modelDefinition.textures[textureName];
            } else {
                textureJSON = `../minecraft/textures/block/${modelDefinition.textures[textureName].split("/").pop()}.png`;
            }
            baseModel.textures[`#${textureName}`] = textureJSON;
        }
    }

    if ("elements" in modelDefinition) {
        baseModel.elements = [];

        for (let cuboid of modelDefinition.elements) {
            //TODO: replace to handle default behavior
            baseModel.elements.push(cuboid);
        }
    }

    return baseModel;
}

function cleanModelTextureLinks(textures) {
    for (const key of Object.keys(textures)) {
        while (textures[key].startsWith("#")) {
            textures[key] = textures[textures[key]];
        }
    }
}

const Faces = {
    DOWN: "down",
    UP: "up",
    NORTH: "north",
    SOUTH: "south",
    EAST: "east",
    WEST: "west"
};
const ALL_FACES = [Faces.DOWN, Faces.UP, Faces.NORTH, Faces.SOUTH, Faces.EAST, Faces.WEST];

async function getBlockTextures(blockModel, faces = ALL_FACES) {
    let cuboidList = [];

    for (const cuboid of blockModel.elements) {
        let adjustedTextures = [];
        let faceDirection = [];

        for (const face of faces) {
            if (face in cuboid.faces) {
                adjustedTextures.push(getBlockFace(cuboid.faces[face], blockModel.textures));
                faceDirection.push(face);
            }
        }

        adjustedTextures = await Promise.all(adjustedTextures);
        cuboidList.push(adjustedTextures.map((v, i) => ({ imageData: v, face: faceDirection[i] })));
    }

    return cuboidList;
}

// TODO: I have no clue how tintindex works, but it's also only used for pink petals supposedly
async function getBlockFace(faceData, textureMap) {
    let imageLocation = textureMap[faceData.texture];

    const response = await fetch(`${imageLocation}.mcmeta`);

    if(response.ok) {
        return convertAnimationToRGBAData(imageLocation, (await response.json()).animation, faceData);
    }
    
    return convertFaceToRGBAData(imageLocation, faceData);
}

async function convertAnimationToRGBAData(imageLocation, animationData, faceData) {
    const imageBits = await fetch(imageLocation)
        .then(res => res.blob())
        .then(async blob => createImageBitmap(blob))
        .catch(reason => console.error(reason));

    const pixelWidth = imageBits.width;
    const pixelHeight = imageBits.height;
    const renderedWidth = animationData.width ?? (animationData.height == null ? null : pixelWidth) ?? Math.min(pixelWidth, pixelHeight);
    const renderedHeight = animationData.height ?? (animationData.width == null ? null : pixelHeight) ?? Math.min(pixelWidth, pixelHeight);

    const offsetX = Math.min(faceData.uv[0], faceData.uv[2]) / 16.0 * renderedWidth;
    const offsetY = Math.min(faceData.uv[1], faceData.uv[3]) / 16.0 * renderedHeight;
    const offsetWidth = Math.abs(faceData.uv[2] - faceData.uv[0]) / 16.0 * renderedWidth;
    const offsetHeight = Math.abs(faceData.uv[3] - faceData.uv[1]) / 16.0 * renderedHeight;

    let renderer = new OffscreenCanvas(pixelWidth, pixelHeight);
    let context = renderer.getContext("2d", { willReadFrequently: true });

    const horizontalUVFlip = faceData.uv[2] - faceData.uv[0] < 0;
    const verticalUVFlip = faceData.uv[3] - faceData.uv[1] < 0;
    context.setTransform(horizontalUVFlip ? -1 : 1, 0, 0, verticalUVFlip ? -1 : 1, horizontalUVFlip ? renderedWidth : 0, verticalUVFlip ? renderedHeight : 0);

    let rowCount = pixelHeight / renderedHeight;
    let colCount = pixelWidth / renderedWidth;
    context.drawImage(imageBits, 0, 0);

    let output = {
        doInterpolate: animationData.interpolate ?? false,
        framePixels: [],
        frameWidth: offsetWidth,
        frameHeight: offsetHeight
    };
    const frameTransitions = animationData.frames ?? [...Array(rowCount * colCount).keys()];
    
    for (let frame = 0; frame < frameTransitions.length; frame++) {
        let index = frameTransitions[frame].index ?? frameTransitions[frame];

        if(horizontalUVFlip) { // Frames are right to left instead of left to right
            index = Math.floor(index / colCount) * colCount + (colCount - index % colCount - 1);
        }
        if(verticalUVFlip) { // Frames are bottom to top instead of top to bottom
            index = index % colCount + (rowCount - Math.floor(index / colCount) - 1) * colCount;
        }

        const imageData = context.getImageData((index % colCount) * renderedWidth + offsetX, Math.floor(index / colCount) * renderedHeight + offsetY, offsetWidth, offsetHeight);

        output.framePixels.push({
            duration: frameTransitions[frame].time ?? animationData.frametime ?? 1,
            pixels: []
        });

        for (let x = 0; x < offsetHeight; x++) {
            for (let y = 0; y < offsetWidth; y++) {
                const rPos = 4 * (x * offsetWidth + y);

                // r, g, b, a
                output.framePixels[frame].pixels.push([imageData.data[rPos], imageData.data[rPos + 1], imageData.data[rPos + 2], imageData.data[rPos + 3]]);
            }
        }
    }

    return output;
}

async function convertFaceToRGBAData(imageLocation, faceData) {
    const imageBits = await fetch(imageLocation)
        .then(res => res.blob())
        .then(async blob => createImageBitmap(blob))
        .catch(reason => console.error(reason));

    let pixelWidth = imageBits.width;
    let pixelHeight = imageBits.height;
    const renderedDX = Math.min(faceData.uv[0], faceData.uv[2]) / 16.0 * pixelWidth;
    const renderedDY = Math.min(faceData.uv[1], faceData.uv[3]) / 16.0 * pixelHeight;
    let renderedWidth = Math.abs(faceData.uv[2] - faceData.uv[0]) / 16.0 * pixelWidth;
    let renderedHeight = Math.abs(faceData.uv[3] - faceData.uv[1]) / 16.0 * pixelHeight;

    let renderer = new OffscreenCanvas(renderedWidth, renderedHeight);
    let context = renderer.getContext("2d");

    const horizontalUVFlip = faceData.uv[2] - faceData.uv[0] < 0;
    const verticalUVFlip = faceData.uv[3] - faceData.uv[1] < 0;
    context.setTransform(horizontalUVFlip ? -1 : 1, 0, 0, verticalUVFlip ? -1 : 1, horizontalUVFlip ? renderedWidth : 0, verticalUVFlip ? renderedHeight : 0);
    context.drawImage(imageBits, renderedDX, renderedDY, renderedWidth, renderedHeight, 0, 0, renderedWidth, renderedHeight);

    const imageData = context.getImageData(0, 0, renderedWidth, renderedHeight);
    let output = [];

    for (let x = 0; x < renderedHeight; x++) {
        for (let y = 0; y < renderedWidth; y++) {
            const rPos = 4 * (x * renderedWidth + y);

            // r, g, b, a
            output.push([imageData.data[rPos], imageData.data[rPos + 1], imageData.data[rPos + 2], imageData.data[rPos + 3]]);
        }
    }

    return {
        width: renderedWidth,
        height: renderedHeight,
        pixels: output,
        uvRotation: faceData.rotation ?? 0
    };
}
