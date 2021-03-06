define("dojo/store/Observable", ["dojo"], function(dojo) {

dojo.store.Observable = function(store){
	//	summary: 
	//		The Observable store wrapper takes a store and sets an observe method on query()
	// 		results that can be used to monitor results for changes
	var queryUpdaters = [], revision = 0;
	// a Comet driven store could directly call notify to notify observers when data has
	// changed on the backend
	var notifyAll = store.notify = function(object, existingId){
		revision++;
		var updaters = queryUpdaters.slice();
		for(var i = 0, l = updaters.length; i < l; i++){
			updaters[i](object, existingId);
		}
	};
	var originalQuery = store.query;
	store.query = function(query, options){
		options = options || {};
		var results = originalQuery.apply(this, arguments);
		if(results && results.forEach){
			var nonPagedOptions = dojo.mixin({}, options);
			delete nonPagedOptions.start;
			delete nonPagedOptions.count;
			
			var queryExecutor = store.queryEngine && store.queryEngine(query, nonPagedOptions);
			var queryRevision = revision;
			var listeners = [], queryUpdater;
			results.observe = function(listener, includeObjectUpdates){
				if(listeners.push(listener) == 1){
					// first listener was added, create the query checker and updater
					queryUpdaters.push(queryUpdater = function(changed, existingId){
						dojo.when(results, function(resultsArray){
							var atEnd = resultsArray.length != options.count;
							var i;
							if(++queryRevision != revision){
								throw new Error("Query is out of date, you must observe() the query prior to any data modifications");
							}
							var removedObject, removedFrom, insertedInto;
							if(existingId){
								// remove the old one
								for(i = 0, l = resultsArray.length; i < l; i++){
									var object = resultsArray[i];
									if(store.getIdentity(object) == existingId){
										removedObject = object;
										removedFrom = i;
										resultsArray.splice(i, 1);
										break;
									}
								}
							}
							if(queryExecutor){
								// add the new one
								if(changed && 
										// if a matches function exists, use that (probably more efficient)
										(queryExecutor.matches ? queryExecutor.matches(changed) : queryExecutor([changed]).length)){ 

									if(removedFrom > -1){
										// put back in the original slot so it doesn't move unless it needs to (relying on a stable sort below)
										resultsArray.splice(removedFrom, 0, changed);
									}else{
										resultsArray.push(changed);
									}
									insertedInto = queryExecutor(resultsArray).indexOf(changed);
									if((options.start && insertedInto == 0) ||
										(!atEnd && insertedInto == resultsArray.length -1)){
										// if it is at the end of the page, assume it goes into the prev or next page
										insertedInto = -1;
									}
								}
							}else if(changed){
								// we don't have a queryEngine, so we can't provide any information 
								// about where it was inserted, but we can at least indicate a new object  
								insertedInto = removedFrom >= 0 ? removedFrom : -1;
							}
							if((removedFrom > -1 || insertedInto > -2) && 
									(includeObjectUpdates || !queryExecutor || (removedFrom != insertedInto))){
								var copyListeners = listeners.slice();
								for(i = 0;listener = copyListeners[i]; i++){
									listener(changed || removedObject, removedFrom, insertedInto);
								}
							}
						});
					});
				}
				return {
					cancel: function(){
						// remove this listener
						listeners.splice(dojo.indexOf(listeners, listener), 1);
						if(!listeners.length){
							// no more listeners, remove the query updater too
							queryUpdaters.splice(dojo.indexOf(queryUpdaters, queryUpdater), 1);
						}
					}
				};
			};
		}
		return results;
	};
	var inMethod;
	function whenFinished(method, action){
		var original = store[method];
		if(original){
			store[method] = function(value){
				if(inMethod){
					// if one method calls another (like add() calling put()) we don't want two events
					return original.apply(this, arguments);
				}
				inMethod = true;
				try{
					return dojo.when(original.apply(this, arguments), function(results){
						action((typeof results == "object" && results) || value);
						return results;
					});
				}finally{
					inMethod = false;
				}
			};
		}		
	}
	// monitor for updates by listening to these methods  
	whenFinished("put", function(object){
		notifyAll(object, store.getIdentity(object));
	});
	whenFinished("add", notifyAll);
	whenFinished("remove", function(id){
		notifyAll(undefined, id);
	});

	return store;
};

return dojo.store.Observable;
});