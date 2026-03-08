#!/usr/bin/env bash

DIST_DIR="docs.build"

# Create the distribution directory if it doesn't exist
mkdir -p "$DIST_DIR"

# Generate .rst files from README.md files
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/websdr.rst README.md
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/core.rst packages/core/README.md
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/frontend-core.rst packages/frontend-core/README.md
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/nestjs-microservice.rst packages/nestjs-microservice/README.md
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/vue3-components.rst packages/vue3-components/README.md
pandoc -s -f gfm -t rst --wrap=preserve -o $DIST_DIR/test-apps.rst test-apps/README.md

# Update links in the generated .rst files
sed -E -i \
	-e 's|`packages/([^/]+)/README.md.*`__|:doc:`/webdev/websdr/\1`|g' \
	-e 's|<docs/|<https://github.com/wavelet-lab/websdr/tree/main/docs/|g' \
	"$DIST_DIR"/*.rst

echo "Docs generated."
