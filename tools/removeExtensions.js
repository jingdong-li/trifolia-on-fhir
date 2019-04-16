"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const baseTools_1 = require("./baseTools");
class RemoveExtensions extends baseTools_1.BaseTools {
    constructor(options) {
        super();
        this.options = options;
        if (typeof this.options.extension === 'string') {
            this.options.extension = [this.options.extension];
        }
        else if (!this.options.extension) {
            this.options.extension = [];
        }
        if (typeof this.options.excludeResourceType === 'string') {
            this.options.excludeResourceType = [this.options.excludeResourceType];
        }
        else if (!this.options.excludeResourceType) {
            this.options.excludeResourceType = [];
        }
    }
    removeExtensions(allResources) {
        const changedResources = [];
        _.each(allResources, (resource) => {
            let resourceChanged = false;
            if (this.options.excludeResourceType.indexOf(resource.resourceType) >= 0) {
                return;
            }
            const foundExtensions = _.filter(resource.extension, (extension) => {
                return this.options.extension.indexOf(extension.url) >= 0;
            });
            _.each(foundExtensions, (foundExtension) => {
                const index = resource.extension.indexOf(foundExtension);
                resource.extension.splice(index, 1);
                resourceChanged = true;
            });
            if (resourceChanged) {
                changedResources.push(resource);
            }
        });
        return changedResources;
    }
    execute() {
        this.getAllResources(this.options.server)
            .then((allResources) => {
            const changedResources = this.removeExtensions(allResources);
            console.log(`Changes are being saved for ${changedResources.length} resources`);
            const savePromises = _.map(changedResources, (changedResource) => this.saveResource(this.options.server, changedResource));
            return Promise.all(savePromises);
        })
            .then(() => {
            console.log('All changes have been saved');
            process.exit(0);
        })
            .catch((err) => {
            console.error(err);
            process.exit(1);
        });
    }
}
exports.RemoveExtensions = RemoveExtensions;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVtb3ZlRXh0ZW5zaW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJlbW92ZUV4dGVuc2lvbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFDQSwyQ0FBc0M7QUFVdEMsTUFBYSxnQkFBaUIsU0FBUSxxQkFBUztJQUczQyxZQUFZLE9BQWdDO1FBQ3hDLEtBQUssRUFBRSxDQUFDO1FBRVIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFFdkIsSUFBSSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxLQUFLLFFBQVEsRUFBRTtZQUM1QyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7U0FDckQ7YUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUU7WUFDaEMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDO1NBQy9CO1FBRUQsSUFBSSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLEtBQUssUUFBUSxFQUFFO1lBQ3RELElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUM7U0FDekU7YUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsRUFBRTtZQUMxQyxJQUFJLENBQUMsT0FBTyxDQUFDLG1CQUFtQixHQUFHLEVBQUUsQ0FBQztTQUN6QztJQUNMLENBQUM7SUFFTyxnQkFBZ0IsQ0FBQyxZQUE4QjtRQUNuRCxNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztRQUU1QixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFO1lBQzlCLElBQUksZUFBZSxHQUFHLEtBQUssQ0FBQztZQUU1QixJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQ3RFLE9BQU87YUFDVjtZQUVELE1BQU0sZUFBZSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxDQUFDLFNBQVMsRUFBRSxFQUFFO2dCQUMvRCxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzlELENBQUMsQ0FBQyxDQUFDO1lBRUgsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxjQUFjLEVBQUUsRUFBRTtnQkFDdkMsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7Z0JBQ3pELFFBQVEsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztnQkFDcEMsZUFBZSxHQUFHLElBQUksQ0FBQztZQUMzQixDQUFDLENBQUMsQ0FBQztZQUVILElBQUksZUFBZSxFQUFFO2dCQUNqQixnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7YUFDbkM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sZ0JBQWdCLENBQUM7SUFDNUIsQ0FBQztJQUVNLE9BQU87UUFDVixJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO2FBQ3BDLElBQUksQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFO1lBQ25CLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQyxDQUFDO1lBRTdELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLGdCQUFnQixDQUFDLE1BQU0sWUFBWSxDQUFDLENBQUM7WUFFaEYsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDO1lBQzNILE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNyQyxDQUFDLENBQUM7YUFDRCxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ1AsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO1lBQzNDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsQ0FBQyxDQUFDO2FBQ0QsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDWCxPQUFPLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25CLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsQ0FBQyxDQUFDLENBQUM7SUFDWCxDQUFDO0NBQ0o7QUFwRUQsNENBb0VDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcmVxdWVzdCBmcm9tICdyZXF1ZXN0JztcbmltcG9ydCB7QmFzZVRvb2xzfSBmcm9tICcuL2Jhc2VUb29scyc7XG5pbXBvcnQge0ZoaXJ9IGZyb20gJy4uL3NlcnZlci9jb250cm9sbGVycy9tb2RlbHMnO1xuaW1wb3J0IERvbWFpblJlc291cmNlID0gRmhpci5Eb21haW5SZXNvdXJjZTtcblxuZXhwb3J0IGludGVyZmFjZSBSZW1vdmVFeHRlbnNpb25zT3B0aW9ucyB7XG4gICAgc2VydmVyOiBzdHJpbmc7XG4gICAgZXh0ZW5zaW9uOiBzdHJpbmcgfCBzdHJpbmdbXTtcbiAgICBleGNsdWRlUmVzb3VyY2VUeXBlOiBzdHJpbmcgfCBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGNsYXNzIFJlbW92ZUV4dGVuc2lvbnMgZXh0ZW5kcyBCYXNlVG9vbHMge1xuICAgIHJlYWRvbmx5IG9wdGlvbnM6IFJlbW92ZUV4dGVuc2lvbnNPcHRpb25zO1xuXG4gICAgY29uc3RydWN0b3Iob3B0aW9uczogUmVtb3ZlRXh0ZW5zaW9uc09wdGlvbnMpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5vcHRpb25zLmV4dGVuc2lvbiA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5leHRlbnNpb24gPSBbdGhpcy5vcHRpb25zLmV4dGVuc2lvbl07XG4gICAgICAgIH0gZWxzZSBpZiAoIXRoaXMub3B0aW9ucy5leHRlbnNpb24pIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5leHRlbnNpb24gPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5vcHRpb25zLmV4Y2x1ZGVSZXNvdXJjZVR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuZXhjbHVkZVJlc291cmNlVHlwZSA9IFt0aGlzLm9wdGlvbnMuZXhjbHVkZVJlc291cmNlVHlwZV07XG4gICAgICAgIH0gZWxzZSBpZiAoIXRoaXMub3B0aW9ucy5leGNsdWRlUmVzb3VyY2VUeXBlKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuZXhjbHVkZVJlc291cmNlVHlwZSA9IFtdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZW1vdmVFeHRlbnNpb25zKGFsbFJlc291cmNlczogRG9tYWluUmVzb3VyY2VbXSk6IERvbWFpblJlc291cmNlW10ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkUmVzb3VyY2VzID0gW107XG5cbiAgICAgICAgXy5lYWNoKGFsbFJlc291cmNlcywgKHJlc291cmNlKSA9PiB7XG4gICAgICAgICAgICBsZXQgcmVzb3VyY2VDaGFuZ2VkID0gZmFsc2U7XG5cbiAgICAgICAgICAgIGlmICh0aGlzLm9wdGlvbnMuZXhjbHVkZVJlc291cmNlVHlwZS5pbmRleE9mKHJlc291cmNlLnJlc291cmNlVHlwZSkgPj0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgZm91bmRFeHRlbnNpb25zID0gXy5maWx0ZXIocmVzb3VyY2UuZXh0ZW5zaW9uLCAoZXh0ZW5zaW9uKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMub3B0aW9ucy5leHRlbnNpb24uaW5kZXhPZihleHRlbnNpb24udXJsKSA+PSAwO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIF8uZWFjaChmb3VuZEV4dGVuc2lvbnMsIChmb3VuZEV4dGVuc2lvbikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gcmVzb3VyY2UuZXh0ZW5zaW9uLmluZGV4T2YoZm91bmRFeHRlbnNpb24pO1xuICAgICAgICAgICAgICAgIHJlc291cmNlLmV4dGVuc2lvbi5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgICAgIHJlc291cmNlQ2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKHJlc291cmNlQ2hhbmdlZCkge1xuICAgICAgICAgICAgICAgIGNoYW5nZWRSZXNvdXJjZXMucHVzaChyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBjaGFuZ2VkUmVzb3VyY2VzO1xuICAgIH1cblxuICAgIHB1YmxpYyBleGVjdXRlKCkge1xuICAgICAgICB0aGlzLmdldEFsbFJlc291cmNlcyh0aGlzLm9wdGlvbnMuc2VydmVyKVxuICAgICAgICAgICAgLnRoZW4oKGFsbFJlc291cmNlcykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5nZWRSZXNvdXJjZXMgPSB0aGlzLnJlbW92ZUV4dGVuc2lvbnMoYWxsUmVzb3VyY2VzKTtcblxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBDaGFuZ2VzIGFyZSBiZWluZyBzYXZlZCBmb3IgJHtjaGFuZ2VkUmVzb3VyY2VzLmxlbmd0aH0gcmVzb3VyY2VzYCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzYXZlUHJvbWlzZXMgPSBfLm1hcChjaGFuZ2VkUmVzb3VyY2VzLCAoY2hhbmdlZFJlc291cmNlKSA9PiB0aGlzLnNhdmVSZXNvdXJjZSh0aGlzLm9wdGlvbnMuc2VydmVyLCBjaGFuZ2VkUmVzb3VyY2UpKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoc2F2ZVByb21pc2VzKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0FsbCBjaGFuZ2VzIGhhdmUgYmVlbiBzYXZlZCcpO1xuICAgICAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgICAgICB9KTtcbiAgICB9XG59Il19